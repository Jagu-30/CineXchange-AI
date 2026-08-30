// Typed client for the autonomous CineXchange orchestrator (services/orchestrator).
//
// Two things this file exists to get right, because the previous client got both
// wrong:
//
//  1. AUTH. Every endpoint except POST /auth/token, GET /healthz and the SSE
//     stream is guarded by `require_producer` and answers 403 with no
//     Authorization header at all, 401 with a bad or expired one. The client
//     mints a demo token once, caches it, attaches it, and refreshes exactly
//     once on a 401 before giving up. Concurrent callers share one in-flight
//     token request rather than stampeding /auth/token.
//
//  2. IDENTIFIERS. `productionId` is a required argument everywhere. The old
//     client defaulted it to the literal 'PROJ-001' in 13 of 16 methods; this
//     backend is UUID-only, so that default could only ever have produced a 422
//     or, worse, silently addressed the wrong run.
//
// There are no per-step methods (runScout / startNegotiation / acceptOffer /
// runCompliance and friends). The backend has no such endpoints: one
// POST /productions runs all ten steps by itself and pauses only at the single
// producer approval gate. Progress is observed over SSE, not driven by clicks.

import type {
  ApprovalDecision,
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  CreateProductionRequest,
  CreateProductionResponse,
  HealthResponse,
  ProductionDetail,
  ProductionListResponse,
  ProductionStatusResponse,
  RecoveryRequest,
  RecoveryResponse,
  StepStreamEvent,
  StreamEndEvent,
  TokenResponse,
  TraceResponse,
} from './types';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Errors
//
// Pages have to tell 409 (this approval was already decided / there is nothing
// to recover) apart from 503 (an agent is unreachable) apart from a dead
// network, so each gets its own class. `Object.setPrototypeOf` is required
// because tsconfig targets ES5, where subclassing a built-in otherwise breaks
// `instanceof`.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  /** Raw response body, for diagnostics. May be empty. */
  readonly body: string;
  /** FastAPI's `detail` field when the body was JSON, else null. */
  readonly detail: string | null;

  constructor(message: string, status: number, endpoint: string, body: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
    this.detail = extractDetail(body);
  }
}

/** 401/403 — no token was sent, or the token was rejected even after a refresh. */
export class AuthError extends ApiError {}

/** 404 — unknown production or unknown approval. */
export class NotFoundError extends ApiError {}

/**
 * 409 — the request contradicts state that already exists. Raised by the
 * backend for an approval that was already decided, and for a recovery trigger
 * on a production with no confirmed booking.
 */
export class ConflictError extends ApiError {}

/** 422 — the body or a path parameter failed validation (e.g. a non-UUID id). */
export class ValidationError extends ApiError {}

/** 503 — an MCP agent could not be reached. The request may be retried. */
export class AgentUnavailableError extends ApiError {}

/** The request never reached the API: DNS, CORS, TLS, offline, or an aborted fetch. */
export class NetworkError extends Error {
  readonly endpoint: string;
  readonly cause: unknown;

  constructor(message: string, endpoint: string, cause: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

/** The SSE stream failed. `willRetry` is true while EventSource is still reconnecting. */
export class StreamError extends Error {
  readonly productionId: string;
  readonly willRetry: boolean;

  constructor(message: string, productionId: string, willRetry: boolean) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'StreamError';
    this.productionId = productionId;
    this.willRetry = willRetry;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isConflictError(err: unknown): err is ConflictError {
  return err instanceof ApiError && err.status === 409;
}

export function isAgentUnavailableError(err: unknown): err is AgentUnavailableError {
  return err instanceof ApiError && err.status === 503;
}

function extractDetail(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
  } catch {
    // Not JSON — the raw body is already on the error.
  }
  return null;
}

function errorFor(status: number, statusText: string, endpoint: string, body: string): ApiError {
  const detail = extractDetail(body);
  const message = `${endpoint} failed: ${status} ${statusText}${detail ? ` — ${detail}` : ''}`;
  switch (status) {
    case 401:
    case 403:
      return new AuthError(message, status, endpoint, body);
    case 404:
      return new NotFoundError(message, status, endpoint, body);
    case 409:
      return new ConflictError(message, status, endpoint, body);
    case 422:
      return new ValidationError(message, status, endpoint, body);
    case 503:
      return new AgentUnavailableError(message, status, endpoint, body);
    default:
      return new ApiError(message, status, endpoint, body);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface EventStreamHandlers {
  /** The stream connected (or reconnected). */
  onOpen?: () => void;
  /**
   * A pipeline step changed state. On connect the server replays every step
   * recorded so far, and an EventSource reconnect replays them again — dedupe
   * on `seq`, which is monotonic per production.
   */
  onStep?: (event: StepStreamEvent) => void;
  /** The run reached a terminal state. The subscription closes itself after this. */
  onEnd?: (event: StreamEndEvent) => void;
  onError?: (error: StreamError) => void;
}

/** Idempotent. Safe to call from a React effect cleanup. */
export type Unsubscribe = () => void;

class CineXchangeApiClient {
  readonly baseUrl = API_BASE_URL;

  private token: string | null = null;
  /** Shared by every concurrent caller so /auth/token is hit once, not N times. */
  private tokenRequest: Promise<string> | null = null;

  // --- auth ---------------------------------------------------------------

  /**
   * The bearer token for every authed call. Cached for the lifetime of the page;
   * pass `forceRefresh` to discard the cached one and mint a new one.
   */
  async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token) return this.token;
    if (forceRefresh) this.token = null;

    if (!this.tokenRequest) {
      this.tokenRequest = this.requestToken()
        .then((token) => {
          this.token = token;
          return token;
        })
        .finally(() => {
          this.tokenRequest = null;
        });
    }
    return this.tokenRequest;
  }

  /** Drop the cached token. The next authed call mints a fresh one. */
  clearToken(): void {
    this.token = null;
  }

  private async requestToken(): Promise<string> {
    const body = await this.send<TokenResponse>('/auth/token', { method: 'POST' }, null);
    return body.access_token;
  }

  // --- transport ----------------------------------------------------------

  private async send<T>(
    endpoint: string,
    init: RequestInit,
    token: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
    } catch (err) {
      throw new NetworkError(
        `${endpoint} could not be reached at ${this.baseUrl}`,
        endpoint,
        err,
      );
    }

    if (!res.ok) {
      throw errorFor(res.status, res.statusText, endpoint, await res.text().catch(() => ''));
    }

    if (res.status === 204) return undefined as unknown as T;

    const text = await res.text();
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new ApiError(
        `${endpoint} returned a body that is not JSON`,
        res.status,
        endpoint,
        text,
      );
    }
  }

  /** Authed request: attach the token, and on a 401 refresh once and retry once. */
  private async authed<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    try {
      return await this.send<T>(endpoint, init, token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const fresh = await this.getToken(true);
        return this.send<T>(endpoint, init, fresh);
      }
      throw err;
    }
  }

  // --- endpoints ----------------------------------------------------------

  /** GET /healthz — unauthenticated. Reports which MCP agents are reachable. */
  async getHealth(): Promise<HealthResponse> {
    return this.send<HealthResponse>('/healthz', { method: 'GET' }, null);
  }

  /** GET /productions — this producer's runs, newest first. */
  async listProductions(limit = 50): Promise<ProductionListResponse> {
    return this.authed<ProductionListResponse>(
      `/productions?limit=${encodeURIComponent(String(limit))}`,
      { method: 'GET' },
    );
  }

  /**
   * POST /productions — 202. Submits the brief and returns immediately; the ten
   * agent steps then run on their own. Follow them with `subscribeToEvents`.
   */
  async createProduction(input: CreateProductionRequest): Promise<CreateProductionResponse> {
    return this.authed<CreateProductionResponse>('/productions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** GET /productions/{id} — the full aggregate read model in one round trip. */
  async getProduction(productionId: string): Promise<ProductionDetail> {
    return this.authed<ProductionDetail>(
      `/productions/${encodeURIComponent(productionId)}`,
      { method: 'GET' },
    );
  }

  /** GET /productions/{id}/status — the cheap snapshot: status, cost, pending approval. */
  async getStatus(productionId: string): Promise<ProductionStatusResponse> {
    return this.authed<ProductionStatusResponse>(
      `/productions/${encodeURIComponent(productionId)}/status`,
      { method: 'GET' },
    );
  }

  /** GET /productions/{id}/trace — every agent decision, in order. */
  async getTrace(productionId: string): Promise<TraceResponse> {
    return this.authed<TraceResponse>(
      `/productions/${encodeURIComponent(productionId)}/trace`,
      { method: 'GET' },
    );
  }

  /** The SSE URL. Exposed for debugging; prefer `subscribeToEvents`. */
  eventsUrl(productionId: string): string {
    return `${this.baseUrl}/productions/${encodeURIComponent(productionId)}/events`;
  }

  /**
   * GET /productions/{id}/events — live pipeline progress over SSE.
   *
   * The route carries no auth dependency because EventSource cannot set an
   * Authorization header; nothing is attached here either.
   *
   * Returns an unsubscribe function. Call it from a React effect cleanup: without
   * it an unmounted component leaves the connection open, and the browser would
   * silently reconnect and replay the whole run. The subscription also closes
   * itself on the terminal `end` event, which is what stops EventSource from
   * reconnecting the moment the server hangs up.
   */
  subscribeToEvents(productionId: string, handlers: EventStreamHandlers): Unsubscribe {
    // Server-rendered passes have no EventSource. Hand back a no-op so callers
    // never need to branch on the environment.
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return () => {};
    }

    let closed = false;
    const source = new EventSource(this.eventsUrl(productionId));

    const close = () => {
      if (closed) return;
      closed = true;
      source.removeEventListener('step', onStep);
      source.removeEventListener('end', onEnd);
      source.onopen = null;
      source.onerror = null;
      source.close();
    };

    const onStep = (event: Event) => {
      if (closed) return;
      const parsed = parseEventData<StepStreamEvent>(event);
      if (parsed === null) {
        handlers.onError?.(
          new StreamError('received a malformed step event', productionId, true),
        );
        return;
      }
      handlers.onStep?.(parsed);
    };

    const onEnd = (event: Event) => {
      if (closed) return;
      const parsed = parseEventData<StreamEndEvent>(event);
      // Close before handing control back: the server has already hung up, and
      // an open EventSource would immediately reconnect and replay everything.
      close();
      if (parsed === null) {
        handlers.onError?.(
          new StreamError('received a malformed end event', productionId, false),
        );
        return;
      }
      handlers.onEnd?.(parsed);
    };

    source.addEventListener('step', onStep);
    source.addEventListener('end', onEnd);

    source.onopen = () => {
      if (!closed) handlers.onOpen?.();
    };

    source.onerror = () => {
      if (closed) return;
      // readyState CLOSED means the browser has given up; CONNECTING means it is
      // still retrying on its own and steps will be replayed from seq 0.
      const willRetry = source.readyState !== EventSource.CLOSED;
      if (!willRetry) close();
      handlers.onError?.(
        new StreamError(
          willRetry
            ? 'event stream dropped; reconnecting'
            : 'event stream closed and will not reconnect',
          productionId,
          willRetry,
        ),
      );
    };

    return close;
  }

  /**
   * POST /productions/{id}/recovery — run the seven-step recovery for a booking
   * whose vendor dropped out. Omit `booking_id` and the backend takes the most
   * expensive confirmed booking.
   *
   * Throws ConflictError (409) when there is no confirmed booking to recover,
   * and AgentUnavailableError (503) when recovery-agent cannot be reached.
   * An `outcome` of `already_in_progress` is a success, not an error: a recovery
   * was already running and this call returned that one.
   */
  async triggerRecovery(productionId: string, input: RecoveryRequest): Promise<RecoveryResponse> {
    return this.authed<RecoveryResponse>(
      `/productions/${encodeURIComponent(productionId)}/recovery`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  /**
   * POST /approvals/{approval_id}/decide — the single producer gate.
   *
   * Throws ConflictError (409) if this approval was already decided, and
   * AgentUnavailableError (503) if a recovery approval could not be settled with
   * recovery-agent. `kind` in the response says whether the decision landed on
   * the happy path or on a recovery.
   */
  async decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<ApprovalDecisionResponse> {
    const body: ApprovalDecisionRequest = { decision };
    return this.authed<ApprovalDecisionResponse>(
      `/approvals/${encodeURIComponent(approvalId)}/decide`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
}

function parseEventData<T>(event: Event): T | null {
  const data = (event as MessageEvent<string>).data;
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export const apiClient = new CineXchangeApiClient();
export type { CineXchangeApiClient };
