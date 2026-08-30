'use client';

// The producer console's single source of truth for "which run am I watching,
// and where has it got to".
//
// The previous version fetched a hardcoded PROJ-001 on mount and polled. This
// backend is autonomous: one POST /productions runs all ten agent steps by
// itself and streams progress over SSE, pausing only at the producer approval
// gate. So this provider holds one production id, opens exactly one EventSource
// for it, and closes that stream on unmount, on an id change, and on the
// terminal `end` event.
//
// There is no current production on a first visit. That is a legitimate state,
// not an error: `productionId` is null, `steps` is empty, and nothing is
// fetched. No id is invented.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { apiClient, StreamError } from './api-client';
import type {
  ApprovalDecision,
  ApprovalDecisionResponse,
  CreateProductionRequest,
  CreateProductionResponse,
  Money,
  ProductionDetail,
  ProductionStatus,
  ProductionStatusResponse,
  ProductionSummary,
  RecoveryRequest,
  RecoveryResponse,
  StepStreamEvent,
} from './types';

/** Where the live event stream stands. `idle` means no production is selected. */
export type StreamState = 'idle' | 'connecting' | 'open' | 'ended' | 'error';

export interface MissionContextValue {
  // --- which run ---------------------------------------------------------
  /** null until a production is created or selected. Never a placeholder id. */
  productionId: string | null;
  /** Select a run to watch, or pass null to watch nothing. */
  selectProduction: (productionId: string | null) => void;

  // --- live pipeline -----------------------------------------------------
  /** Every step event seen on the stream, deduplicated by `seq`, ascending. */
  steps: StepStreamEvent[];
  /** The most recent event for each step number, ascending by step. */
  latestStepByNumber: StepStreamEvent[];
  streamState: StreamState;
  /** The status carried by the terminal `end` event, once it arrives. */
  terminalStatus: ProductionStatus | null;
  /** Non-fatal while `willRetry` is true — EventSource is still reconnecting. */
  streamError: StreamError | null;

  // --- snapshots ---------------------------------------------------------
  status: ProductionStatusResponse | null;
  detail: ProductionDetail | null;
  productions: ProductionSummary[];
  /** Convenience: `status.pending_approval_id`. */
  pendingApprovalId: string | null;
  /** `status.status`, falling back to the terminal stream status. */
  productionStatus: ProductionStatus | null;

  // --- request state -----------------------------------------------------
  isLoading: boolean;
  /** The last failed request. Inspect with `isConflictError` / `isAgentUnavailableError`. */
  error: Error | null;
  clearError: () => void;

  // --- actions -----------------------------------------------------------
  /** Submits a brief and selects the new run. Returns null on failure. */
  createProduction: (
    input: CreateProductionRequest,
  ) => Promise<CreateProductionResponse | null>;
  refreshStatus: () => Promise<ProductionStatusResponse | null>;
  refreshDetail: () => Promise<ProductionDetail | null>;
  refreshProductions: (limit?: number) => Promise<ProductionSummary[]>;
  decideApproval: (
    approvalId: string,
    decision: ApprovalDecision,
  ) => Promise<ApprovalDecisionResponse | null>;
  triggerRecovery: (input: RecoveryRequest) => Promise<RecoveryResponse | null>;
}

const MissionContext = createContext<MissionContextValue | null>(null);

const STORAGE_KEY = 'cinex.productionId';

function readStoredProductionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeStoredProductionId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Losing the id across a reload is survivable; listProductions finds it again.
  }
}

/** Insert keeping `seq` ascending and unique — the stream replays on reconnect. */
function mergeStep(steps: StepStreamEvent[], event: StepStreamEvent): StepStreamEvent[] {
  if (steps.some((s) => s.seq === event.seq)) return steps;
  const next = [...steps, event];
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

export function MissionProvider({ children }: { children: ReactNode }) {
  const [productionId, setProductionId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepStreamEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [terminalStatus, setTerminalStatus] = useState<ProductionStatus | null>(null);
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const [status, setStatus] = useState<ProductionStatusResponse | null>(null);
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Reading localStorage during render would desync server and client HTML, so
  // the restore happens after mount instead.
  useEffect(() => {
    const stored = readStoredProductionId();
    if (stored) setProductionId(stored);
  }, []);

  // Lets the async helpers below tell "still the run I was asked about" from
  // "the user has moved on" without re-creating themselves on every id change.
  const productionIdRef = useRef<string | null>(null);
  productionIdRef.current = productionId;

  const clearError = useCallback(() => setError(null), []);

  const selectProduction = useCallback((next: string | null) => {
    setProductionId((current) => (current === next ? current : next));
    writeStoredProductionId(next);
  }, []);

  const fetchStatus = useCallback(async (id: string) => {
    const next = await apiClient.getStatus(id);
    if (productionIdRef.current === id) setStatus(next);
    return next;
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    const next = await apiClient.getProduction(id);
    if (productionIdRef.current === id) setDetail(next);
    return next;
  }, []);

  const refreshStatus = useCallback(async () => {
    const id = productionIdRef.current;
    if (!id) return null;
    try {
      return await fetchStatus(id);
    } catch (err) {
      setError(err as Error);
      return null;
    }
  }, [fetchStatus]);

  const refreshDetail = useCallback(async () => {
    const id = productionIdRef.current;
    if (!id) return null;
    setIsLoading(true);
    try {
      return await fetchDetail(id);
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [fetchDetail]);

  const refreshProductions = useCallback(async (limit = 50) => {
    setIsLoading(true);
    try {
      const res = await apiClient.listProductions(limit);
      setProductions(res.productions);
      return res.productions;
    } catch (err) {
      setError(err as Error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createProduction = useCallback(async (input: CreateProductionRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const created = await apiClient.createProduction(input);
      setProductionId(created.production_id);
      writeStoredProductionId(created.production_id);
      return created;
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const decideApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiClient.decideApproval(approvalId, decision);
        // An approval resumes the pipeline (happy path) or settles a recovery;
        // either way the cached snapshot is now stale.
        await refreshStatus();
        return res;
      } catch (err) {
        setError(err as Error);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshStatus],
  );

  const triggerRecovery = useCallback(
    async (input: RecoveryRequest) => {
      const id = productionIdRef.current;
      if (!id) return null;
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiClient.triggerRecovery(id, input);
        await refreshStatus();
        return res;
      } catch (err) {
        setError(err as Error);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshStatus],
  );

  // One EventSource per production. The cleanup runs on unmount and on every id
  // change, so a component that unmounts mid-run cannot leak the connection —
  // and React 18 StrictMode's mount/unmount/mount is handled by the same path.
  useEffect(() => {
    if (!productionId) {
      setSteps([]);
      setStatus(null);
      setDetail(null);
      setTerminalStatus(null);
      setStreamError(null);
      setStreamState('idle');
      return;
    }

    const id = productionId;
    let cancelled = false;

    setSteps([]);
    setStatus(null);
    setDetail(null);
    setTerminalStatus(null);
    setStreamError(null);
    setStreamState('connecting');

    // The stream carries steps but not cost, budget or the pending approval id,
    // so take one snapshot up front. A run that finished before this page loaded
    // still gets its full step history: the server replays from seq 0 on connect.
    void fetchStatus(id).catch((err) => {
      if (!cancelled) setError(err as Error);
    });

    const unsubscribe = apiClient.subscribeToEvents(id, {
      onOpen: () => {
        if (cancelled) return;
        setStreamError(null);
        setStreamState('open');
      },
      onStep: (event) => {
        if (cancelled) return;
        setSteps((prev) => mergeStep(prev, event));
      },
      onEnd: (event) => {
        if (cancelled) return;
        setTerminalStatus(event.status);
        setStreamState('ended');
        // `awaiting_approval` is terminal for the stream but not for the run —
        // the snapshot is what carries pending_approval_id to the gate UI.
        void fetchStatus(id).catch(() => undefined);
      },
      onError: (err) => {
        if (cancelled) return;
        setStreamError(err);
        if (!err.willRetry) setStreamState('error');
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [productionId, fetchStatus]);

  const latestStepByNumber = useMemo(() => {
    const latest = new Map<number, StepStreamEvent>();
    for (const event of steps) latest.set(event.step, event);
    return Array.from(latest.values()).sort((a, b) => a.step - b.step);
  }, [steps]);

  const value = useMemo<MissionContextValue>(
    () => ({
      productionId,
      selectProduction,
      steps,
      latestStepByNumber,
      streamState,
      terminalStatus,
      streamError,
      status,
      detail,
      productions,
      pendingApprovalId: status?.pending_approval_id ?? null,
      productionStatus: status?.status ?? terminalStatus,
      isLoading,
      error,
      clearError,
      createProduction,
      refreshStatus,
      refreshDetail,
      refreshProductions,
      decideApproval,
      triggerRecovery,
    }),
    [
      productionId,
      selectProduction,
      steps,
      latestStepByNumber,
      streamState,
      terminalStatus,
      streamError,
      status,
      detail,
      productions,
      isLoading,
      error,
      clearError,
      createProduction,
      refreshStatus,
      refreshDetail,
      refreshProductions,
      decideApproval,
      triggerRecovery,
    ],
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission(): MissionContextValue {
  const context = useContext(MissionContext);
  if (context === null) {
    throw new Error(
      'useMission must be used within MissionProvider. ' +
        'Ensure MissionProvider wraps the root layout or _app.',
    );
  }
  return context;
}

// ---------------------------------------------------------------------------
// Display helpers
//
// Backend money is a decimal STRING and is deliberately never parsed into a
// number for storage — that would lose cents. These helpers parse only at the
// moment of rendering.
//
// NOTE: the backend stores no currency at all (see `unavailable.currency`), so
// the rupee symbol below is a presentation choice inherited from the existing
// UI, not a fact from the API. `formatAmount` is the currency-neutral option.
// ---------------------------------------------------------------------------

/** Parses a decimal string for display only. Returns null for null/blank/NaN. */
export function parseMoney(value: Money | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Grouped digits, no currency symbol. */
export function formatAmount(value: Money | number | null | undefined): string {
  const n = parseMoney(value);
  if (n === null) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

export function formatINR(value: Money | number | null | undefined): string {
  const n = parseMoney(value);
  if (n === null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function formatINRLakh(value: Money | number | null | undefined): string {
  const n = parseMoney(value);
  if (n === null) return '—';
  return '₹' + (n / 100000).toFixed(2) + 'L';
}
