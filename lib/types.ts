// CineXchange AI — Full-Stack Multi-Agent Data Contract

export type WorkflowState =
  | 'DRAFT'
  | 'REQUIREMENTS_EXTRACTED'
  | 'SCOUTING'
  | 'CANDIDATES_READY'
  | 'NEGOTIATION_IN_PROGRESS'
  | 'QUOTE_READY'
  | 'COMPLIANCE_CHECKING'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED'
  | 'BOOKED'
  | 'INCIDENT_DETECTED'
  | 'RECOVERY_IN_PROGRESS'
  | 'RECOVERY_APPROVAL_REQUIRED'
  | 'RECOVERY_APPROVED'
  | 'COMPLETED'
  | 'BLOCKED';

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

export interface ProjectInput {
  project_id: string;
  title: string;
  description?: string | null;
  producer_request: string;
  budget: number;
  currency: string;
  duration_days: number;
  start_date?: string | null;
  location: string;
}

export interface Requirement {
  requirement_id: string;
  category: string;
  resource: string;
  resource_type: string;
  quantity: number;
  duration_days: number;
  specifications: Record<string, any>;
  priority: string;
  mandatory: boolean;
  notes?: string | null;
}

export interface CandidateVendor {
  vendor_id: string;
  vendor_name: string;
  resource_id: string;
  resource_name: string;
  resource_type: string;
  price: number;
  currency: string;
  available: boolean;
  delivery_days: number;
  distance_km: number;
  reliability_score: number;
  suitability_score: number;
  quality_score: number;
  insurance_included: boolean;
  insurance_required: boolean;
  location: string;
  specifications?: Record<string, any>;
  included_services: string[];
  metadata?: Record<string, any>;
}

export interface ScoredCandidate {
  candidate: CandidateVendor;
  hard_constraints_passed: boolean;
  score: number;
  score_breakdown: Record<string, number>;
  reasons: string[];
  rejected_reasons: string[];
}

export interface Quote {
  quote_id: string;
  vendor_id: string;
  resource_id: string;
  price: number;
  currency: string;
  delivery_days: number;
  warranty_included: boolean;
  insurance_included: boolean;
  included_services: string[];
  quality_score: number;
  valid_until?: string | null;
  terms: Record<string, any>;
}

export interface NegotiationRound {
  round_number: number;
  offered_by: string; // 'PRODUCER' | 'VENDOR'
  price: number;
  savings_percent: number;
  included_terms: Record<string, any>;
  message: string;
  accepted: boolean;
  timestamp: string;
}

export interface NegotiationState {
  negotiation_id: string;
  vendor_id: string;
  resource_id: string;
  initial_price: number;
  current_price: number;
  target_price: number;
  minimum_price: number;
  rounds: number;
  max_rounds: number;
  target_savings_percent: number;
  minimum_acceptable_quality: number;
  insurance_required: boolean;
  max_delivery_days: number;
  status: string; // 'IN_PROGRESS' | 'ACCEPTED' | 'REJECTED' | 'EXHAUSTED'
  history: NegotiationRound[];
  reasoning?: string | null;
}

export interface CounterOfferInput {
  price: number;
  requested_terms?: Record<string, any>;
  reason?: string;
}

export interface ComplianceDocument {
  document_id: string;
  document_type: string; // 'INSURANCE' | 'CONTRACT' | 'PERMIT' | 'LICENSE'
  vendor_id: string;
  vendor_name: string;
  valid_from: string;
  valid_until: string;
  coverage_amount: number;
  status: string; // 'VALID' | 'EXPIRED' | 'INSUFFICIENT' | 'PENDING' | 'MISSING'
  extraction_confidence: number;
  extracted_fields: Record<string, any>;
  source_reference?: string | null;
}

export interface RiskBreakdown {
  vendor_risk: number;
  contract_risk: number;
  insurance_risk: number;
  permit_risk: number;
  financial_risk: number;
  overall_level: string; // 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED'
  reasons: string[];
}

export interface ApprovalDecision {
  approval_id: string;
  status: string; // 'AUTO_APPROVED' | 'PENDING_PRODUCER_APPROVAL' | 'APPROVED' | 'REJECTED' | 'BLOCKED'
  requires_producer_approval: boolean;
  blocking_reasons: string[];
  approval_reasons: string[];
  next_action: string;
  risk: RiskBreakdown;
}

export interface Incident {
  incident_id: string;
  event: string;
  resource_id: string;
  occurred_at: string;
  severity: string; // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  details: Record<string, any>;
}

export interface RecoveryOption {
  candidate: CandidateVendor;
  compatibility_score: number;
  availability_score: number;
  schedule_score: number;
  cost_score: number;
  reliability_score: number;
  insurance_score: number;
  total_score: number;
  cost_delta: number;
  schedule_delay_days: number;
  reasons: string[];
  risks: string[];
}

export interface BookingRecord {
  booking_id: string;
  resource_id: string;
  resource_name: string;
  vendor_id: string;
  vendor_name: string;
  price: number;
  status: string; // 'CONFIRMED' | 'AT_RISK' | 'REPLACED' | 'CANCELLED'
  delivery_date: string;
  insurance_covered: boolean;
  created_at: string;
}

export interface AuditLogEntry {
  entry_id: string;
  timestamp: string;
  agent: string;
  agent_name: string;
  action: string;
  status: string; // 'processing' | 'successful' | 'approval_required' | 'blocked' | 'failed' | 'recommendation'
  input_summary: string;
  output_summary: string;
  policy_checks: string[];
  warnings: string[];
  next_action: string;
}

export interface ProductionState {
  project: ProjectInput;
  current_state: WorkflowState;
  requirements: Requirement[];
  candidates: ScoredCandidate[];
  quotes: Quote[];
  negotiations: NegotiationState[];
  compliance: ComplianceDocument[];
  risk_assessments?: RiskBreakdown | null;
  approvals: ApprovalDecision[];
  bookings: BookingRecord[];
  incidents: Incident[];
  recovery_options: RecoveryOption[];
  audit_log: AuditLogEntry[];
}

export interface APIResponseEnvelope<T = any> {
  success: boolean;
  data?: T | null;
  errors: string[];
  timestamp: string;
  request_id: string;
}

// Activity & legacy UI contracts
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

export interface OperationalEvent {
  event_id: string;
  event_type: string;
  project_id: string;
  resource_id?: string | null;
  vendor_id?: string | null;
  agent_name?: string | null;
  timestamp: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  payload: Record<string, any>;
  trace_id: string;
  source: string;
  external_incident_id?: string | null;
}

export interface IntegrationStatus {
  grafana: {
    mode: 'MOCK' | 'CLOUD_MCP';
    status: 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';
    endpoint: string;
    last_event?: Record<string, any> | null;
    last_incident_query?: string | null;
    incident_count: number;
    alert_count: number;
    error?: string;
  };
  clickhouse: {
    mode: 'MOCK' | 'CLOUD';
    status: 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';
    table: string;
    endpoint: string;
    events_stored: number;
    last_inserted?: Record<string, any> | null;
    analytics_available: boolean;
    error?: string;
  };
  agent_platform: {
    mode: string;
    model: string;
    status: string;
    api_key_configured: boolean;
    last_call: string;
  };
  mock_mode: boolean;
}

export interface AnalyticsData {
  negotiation: {
    average_negotiated_savings_pct: number;
    average_rounds_to_close: number;
    total_negotiations: number;
    success_rate_pct: number;
    total_value_saved_inr: number;
    average_initial_quote: number;
    average_final_quote: number;
  };
  recovery: {
    recovery_incident_count: number;
    average_recovery_cost_delta_inr: number;
    average_schedule_delay_days: number;
    historical_failure_frequency_pct: number;
    average_resolution_time_minutes: number;
    top_recovered_resource_type: string;
  };
  vendor_reliability: {
    vendor_id: string;
    on_time_delivery_rate_pct: number;
    equipment_uptime_pct: number;
    insurance_compliance_score: number;
    historical_projects_completed: number;
    average_rating: number;
  };
  price_history: Array<{
    date: string;
    price: number;
    vendor_id: string;
    discount_pct: number;
  }>;
  status: any;
}

