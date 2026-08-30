// CineXchange AI — frontend data contract.
//
// SECTION 1 mirrors the autonomous `cinex` orchestrator API (services/orchestrator)
// field-for-field. That backend runs all ten pipeline steps by itself and pauses
// only at a single producer approval gate; there is no per-step invocation, so
// there are no per-step request/response types here.
//
// SECTION 2 holds UI-only presentation types consumed by lib/mockData.ts and the
// shared components. They are not backend-facing and are deliberately unchanged.
//
// Conventions that are NOT negotiable, taken from the backend report:
//   * Every money value is a decimal STRING ("120000.00"). Never a number.
//     Decimal is stringified server-side; parsing to float loses cents.
//   * Timestamps are timezone-aware ISO-8601 UTC ("...+00:00").
//     start_date / end_date are plain calendar dates ("YYYY-MM-DD").
//   * `negotiation` is always an object with four arrays — never null.
//   * `score_breakdown` is ALWAYS null. It is never captured and never will be.
//   * There is no risk assessment and no compliance document store anywhere in
//     the backend. Both are named in `unavailable` with a reason; render an
//     honest empty state instead of inventing data.

// ---------------------------------------------------------------------------
// SECTION 1 — backend contract
// ---------------------------------------------------------------------------

/** A fixed-point decimal serialised as a string, e.g. `"120000.00"`. */
export type Money = string;

/** Timezone-aware ISO-8601 UTC timestamp, e.g. `"2026-08-19T09:12:03.481912+00:00"`. */
export type IsoTimestamp = string;

/** Calendar date with no time component, `"YYYY-MM-DD"`. */
export type IsoDate = string;

/** A backend identifier. Always a UUID — never a slug such as `PROJ-001`. */
export type Uuid = string;

/** Free-form JSON object. Used where the backend guarantees no key set. */
export type JsonObject = Record<string, unknown>;

/** The ten pipeline steps, in execution order. */
export const PIPELINE_STEP_NAMES = [
  'ingest',
  'decompose',
  'discover',
  'solicit',
  'shortlist',
  'negotiate',
  'total',
  'compliance',
  'approval_gate',
  'book',
] as const;

export type PipelineStepName = (typeof PIPELINE_STEP_NAMES)[number];

/** Every value `productions.status` can hold. */
export const PRODUCTION_STATUSES = [
  'draft',
  'decomposing',
  'scouting',
  'negotiating',
  'compliance',
  'awaiting_approval',
  'recovering',
  'booked',
  'failed',
] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/** A pipeline run is over — for this stream — in exactly these states. */
export const TERMINAL_PRODUCTION_STATUSES = [
  'awaiting_approval',
  'booked',
  'failed',
] as const;

export type TerminalProductionStatus = (typeof TERMINAL_PRODUCTION_STATUSES)[number];

export type StepStatus = 'in_progress' | 'done' | 'failed' | 'terminal';

// --- POST /auth/token -------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

// --- GET /healthz -----------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  /**
   * agent name -> its MCP tool names, or the literal string
   * `"unreachable: <error>"` when that agent could not be reached.
   * Use `Array.isArray(value)` to tell the two apart.
   */
  agents: Record<string, string[] | string>;
}

// --- GET /productions?limit=50 ---------------------------------------------

export interface ProductionSummary {
  production_id: Uuid;
  status: ProductionStatus;
  /** Truncated to 200 chars + "..." when `brief_truncated` is true. */
  brief_text: string;
  brief_truncated: boolean;
  budget_cap: Money;
  /** null until pipeline step 7 (`total`) has run. */
  total_cost: Money | null;
  created_at: IsoTimestamp;
}

export interface ProductionListResponse {
  productions: ProductionSummary[];
  /** Always equal to `productions.length`. */
  count: number;
}

// --- POST /productions ------------------------------------------------------

export interface CreateProductionRequest {
  /** Minimum 10 characters — the backend rejects anything shorter with 422. */
  brief_text: string;
  budget_cap: Money;
  location: string;
  start_date: IsoDate;
  end_date: IsoDate;
}

/** HTTP 202. The pipeline then runs in the background; follow it over SSE. */
export interface CreateProductionResponse {
  production_id: Uuid;
  status: ProductionStatus;
}

// --- GET /productions/{id}/status ------------------------------------------

/** A step row as the /status endpoint returns it — no `seq`. */
export interface StatusStep {
  step: number;
  name: PipelineStepName;
  status: StepStatus;
  detail: JsonObject;
  ts: IsoTimestamp;
}

export interface ProductionStatusResponse {
  production_id: Uuid;
  status: ProductionStatus;
  /** 0..10. */
  current_step: number;
  total_cost: Money | null;
  budget_cap: Money;
  /** The approval waiting on the producer, if any. Feed it to `decideApproval`. */
  pending_approval_id: Uuid | null;
  steps: StatusStep[];
}

// --- GET /productions/{id}/events (SSE, no auth) ---------------------------

/** `event: step` payload. */
export interface StepStreamEvent {
  production_id: Uuid;
  /** Monotonic audit sequence. Use it to dedupe across an EventSource reconnect. */
  seq: number;
  step: number;
  name: PipelineStepName;
  status: StepStatus;
  detail: JsonObject;
  ts: IsoTimestamp;
}

/** Terminal `event: end` payload. The server closes the stream after this. */
export interface StreamEndEvent {
  status: ProductionStatus;
}

// --- GET /productions/{id} — the aggregate read model ----------------------

export interface ProductionHeader {
  production_id: Uuid;
  producer_id: Uuid;
  /** Full, untruncated. */
  brief_text: string;
  budget_cap: Money;
  total_cost: Money | null;
  location: string;
  start_date: IsoDate;
  end_date: IsoDate;
  status: ProductionStatus;
  /** 0..10. */
  current_step: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** A step row as the detail endpoint returns it — ordered by `seq`. */
export interface DetailStep extends StatusStep {
  seq: number;
}

/** One scout `find_vendors` call. Recovery re-scouts, so there can be several. */
export interface DiscoveryRun {
  ts: IsoTimestamp;
  category: string | null;
  /** Vendors examined. */
  considered: number | null;
  excluded_vendor_ids: Uuid[];
  offers_returned: number;
}

export interface VendorOffer {
  offer_id: Uuid;
  vendor_id: Uuid;
  vendor_name: string | null;
  vendor_category: string | null;
  /** The vendor's CURRENT mutable rating, not the one it was ranked on. */
  vendor_rating_current: Money | null;
  /** Negotiated / current price, from the offers row. */
  price: Money;
  terms: JsonObject;
  /** pending | negotiated | accepted | rejected */
  status: string;
  rounds_completed: number;
  is_winner: boolean;
  created_at: IsoTimestamp;
  /** Ordinal rank. Lives only in scout's audit payload; null if unranked. */
  rank: number | null;
  /** Audit payload only. */
  available: boolean | null;
  /** The opening quote. `price` is overwritten on accept, so this is its only survivor. */
  quoted_price: Money | null;
  /**
   * ALWAYS null. The scout composite score is computed inside a `sorted(key=...)`
   * and discarded; only the ordinal `rank` survives. Do not build UI that expects
   * this to fill in later. See `unavailable.vendor_score_breakdown`.
   */
  score_breakdown: null;
}

export interface NegotiationRun {
  ts: IsoTimestamp;
  max_rounds: number | null;
  market_anchor: Money | null;
  winning_offer_id: Uuid | null;
  final_price: Money | null;
  settled: boolean | null;
  settled_count: number | null;
  /** Verbatim agent payload. No guaranteed keys. */
  outcomes: JsonObject[];
}

export interface NegotiationRound {
  ts: IsoTimestamp;
  offer_id: Uuid;
  vendor_id: Uuid | null;
  vendor_name: string | null;
  round: number;
  /** What our agent countered with. */
  offered: Money;
  conceded_terms: string[];
  /** The stated reasoning from the negotiation LLM. */
  rationale: string | null;
  /** accept | counter | reject */
  decision: string | null;
  vendor_price: Money | null;
  vendor_message: string | null;
}

export interface NegotiationTerminalEvent {
  ts: IsoTimestamp;
  offer_id: Uuid;
  /** `negotiation_walk_away` | `negotiation_vendor_unavailable` */
  event: string;
  round: number | null;
  rationale: string | null;
  error: string | null;
}

export interface NegotiationFailure {
  ts: IsoTimestamp;
  error: string | null;
  completed_offers: number | null;
  completed_rounds: number | null;
}

/** Always present on a requirement, with four arrays. Never null — do not null-check it. */
export interface RequirementNegotiation {
  runs: NegotiationRun[];
  /** Chronological across all offers for this requirement. */
  rounds: NegotiationRound[];
  terminal_events: NegotiationTerminalEvent[];
  failures: NegotiationFailure[];
}

export interface ProductionRequirement {
  requirement_id: Uuid;
  /** camera | crew | location | transport | permit | ... — free-form LLM output. */
  category: string;
  /** Free-form LLM output. No guaranteed keys. */
  spec: JsonObject;
  quantity: number;
  priority: number;
  created_at: IsoTimestamp;
  discovery_runs: DiscoveryRun[];
  /** Sorted by rank; unranked offers last. */
  offers: VendorOffer[];
  negotiation: RequirementNegotiation;
}

export interface ComplianceCheck {
  check_id: Uuid;
  /** permit | insurance | licensing */
  check_type: string;
  /** pass | fail | pending */
  status: string;
  /**
   * ALWAYS contains `disclaimer: "MOCK DATA - not a real regulatory check"`.
   * There is no document store behind this. See `unavailable.compliance_documents`.
   */
  evidence: JsonObject;
  /** Set for recovery-time rechecks. */
  booking_id: Uuid | null;
  created_at: IsoTimestamp;
}

/** No `documents` key exists. See `unavailable.compliance_documents`. */
export interface ComplianceSummary {
  /** "pass" | "fail" — the audited verdict, from the audit payload. */
  overall: string | null;
  equipment_value: Money | null;
  checks: ComplianceCheck[];
}

/** `happy_path` gates the pipeline; `recovery` gates a replacement that already happened. */
export type ApprovalGateKind = 'happy_path' | 'recovery';

export interface ProductionApproval {
  approval_id: Uuid;
  requested_by_agent: string;
  /** Comma-joined. Carries a `recovery:` prefix for recovery gates. */
  reason: string;
  threshold_breached: boolean;
  delta_amount: Money;
  /** pending | approved | rejected */
  producer_decision: string;
  decided_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  /** Audit / step payload only — there is no column for it. */
  delta_pct: number | null;
  /** Audit / step payload only. */
  reasons: string[] | null;
  /** Recovery gates only. */
  threshold_pct: number | null;
  /** Audit payload only. */
  kind: ApprovalGateKind | null;
}

export interface ProductionBooking {
  booking_id: Uuid;
  offer_id: Uuid;
  requirement_id: Uuid | null;
  vendor_id: Uuid | null;
  vendor_name: string | null;
  vendor_category: string | null;
  vendor_rating_current: Money | null;
  final_price: Money;
  /** confirmed | superseded */
  status: string;
  booked_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

/** One of the seven recovery steps, from the real `recovery_events.timeline` JSONB column. */
export interface RecoveryTimelineEntry {
  /** 1..7. */
  step: number;
  /**
   * find_replacement | negotiate_replacement | recalculate_cost | check_schedule |
   * update_records | present_diff | approval_gate | failed | resolve
   */
  name: string;
  ts: IsoTimestamp;
  /** Shape varies per step. */
  detail: JsonObject;
}

/** No `options` key exists — recovery never presents a choice. See `unavailable.recovery_options`. */
export interface ProductionRecoveryEvent {
  recovery_event_id: Uuid;
  trigger: string;
  /** pending | in_progress | awaiting_approval | resolved | failed */
  status: string;
  affected_booking_id: Uuid | null;
  resolution_booking_id: Uuid | null;
  timeline: RecoveryTimelineEntry[];
  created_at: IsoTimestamp;
}

/** null unless the pipeline failed. */
export interface PipelineFailure {
  ts: IsoTimestamp;
  step: number | null;
  reason: string | null;
}

/**
 * Fields the backend genuinely never captured, each mapped to a human-readable
 * reason. Fixed key set. Render the reason as an honest empty state; do not
 * synthesise the missing data.
 */
export interface UnavailableMap {
  vendor_score_breakdown: string;
  risk_assessment: string;
  compliance_documents: string;
  recovery_options: string;
  producer_profile: string;
  currency: string;
  vendor_contact_details: string;
  savings_vs_list_price: string;
  vendor_rating_at_quote_time: string;
  llm_usage: string;
  step_durations: string;
}

export type UnavailableField = keyof UnavailableMap;

export interface ProductionDetail {
  production: ProductionHeader;
  steps: DetailStep[];
  requirements: ProductionRequirement[];
  compliance: ComplianceSummary;
  approvals: ProductionApproval[];
  bookings: ProductionBooking[];
  recovery_events: ProductionRecoveryEvent[];
  failure: PipelineFailure | null;
  unavailable: UnavailableMap;
}

// --- GET /productions/{id}/trace -------------------------------------------

export interface TraceEntry {
  ts: IsoTimestamp;
  /** producer | orchestrator | producer-agent | scout-agent | negotiation-agent | ... */
  actor: string;
  action: string;
  /** production | requirement | offer | approval | recovery_event */
  entity_type: string;
  entity_id: Uuid | null;
  payload: JsonObject;
}

export interface TraceResponse {
  production_id: Uuid;
  entries: number;
  /** Sorted, deduplicated actor names. */
  actors: string[];
  trace: TraceEntry[];
}

// --- POST /productions/{id}/recovery ---------------------------------------

export type RecoveryOutcome =
  | 'awaiting_approval'
  | 'resolved'
  | 'failed'
  | 'already_in_progress';

export interface RecoveryRequest {
  /** Omit to let the backend pick the most expensive confirmed booking. */
  booking_id?: Uuid | null;
  trigger: string;
}

export interface RecoveryResponse {
  recovery_event_id: Uuid;
  timeline: RecoveryTimelineEntry[];
  outcome: RecoveryOutcome;
}

// --- POST /approvals/{approval_id}/decide ----------------------------------

export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalDecisionRequest {
  decision: ApprovalDecision;
}

export interface ApprovalDecisionResponse {
  approval_id: Uuid;
  decision: ApprovalDecision;
  production_id: Uuid;
  kind: ApprovalGateKind;
}

// ---------------------------------------------------------------------------
// SECTION 2 — UI-only presentation types
//
// Consumed by lib/mockData.ts and components/shared/*. None of these is a
// backend shape; nothing in api-client.ts references them.
// ---------------------------------------------------------------------------

export type AgentId =
  | 'producer'
  | 'scout'
  | 'negotiation'
  | 'compliance'
  | 'recovery'
  | 'policy_engine';

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting_approval'
  | 'done'
  | 'alert'
  | 'blocked';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
}

export type RequirementCategory =
  | 'EQUIPMENT'
  | 'CREW'
  | 'LOGISTICS'
  | 'COMPLIANCE'
  | 'Camera'
  | 'Drone'
  | 'Lighting'
  | 'Generator'
  | 'Pilot'
  | 'Insurance'
  | 'Transport'
  | 'Permit';

export type RequirementStatus =
  | 'sourcing'
  | 'negotiating'
  | 'confirmed'
  | 'at_risk'
  | 'recovered';

export interface RequirementItem {
  id: string;
  category: RequirementCategory;
  itemName: string;
  vendor: string | null;
  originalPrice: number | null;
  negotiatedPrice: number | null;
  status: RequirementStatus;
}

export type ActivityType = 'info' | 'success' | 'warning' | 'approval';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  agent: AgentId;
  agentName: string;
  message: string;
  type: ActivityType;
}

export interface VendorOption {
  id: string;
  rank: number;
  vendorName: string;
  reasoning: string;
  price: number;
  deliveryTime: string;
  rating: number;
  recommended?: boolean;
}

export type ApprovalKind = 'insurance' | 'cost_delta';

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  title: string;
  context: string;
  options: VendorOption[];
  costDelta?: number;
  resolved?: boolean;
  resolution?: 'selected' | 'waitlisted' | 'approved';
  selectedOptionId?: string;
}

export interface BudgetSnapshot {
  label: string;
  committed: number;
  remaining: number;
}

export interface Scenario {
  title: string;
  summary: string;
  description: string;
  budgetCap: number;
  shootDays: number;
}

export interface ProcurementStep {
  step: number;
  title: string;
  agent: AgentId;
  agentName: string;
  description: string;
}
