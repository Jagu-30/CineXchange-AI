// CineXchange AI — Data Contract
// These types define the shape a future backend API should match.

export type AgentId =
  | 'producer'
  | 'scout'
  | 'negotiation'
  | 'compliance'
  | 'recovery';

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting_approval'
  | 'done'
  | 'alert';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
}

export type RequirementCategory =
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
  timestamp: string; // ISO string
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
  // For cost-delta approvals (recovery demo)
  costDelta?: number;
  resolved?: boolean;
  resolution?: 'selected' | 'waitlisted' | 'approved';
  selectedOptionId?: string;
}

export interface BudgetSnapshot {
  label: string;       // time bucket, e.g. "T-0", "Day 1"
  committed: number;   // cumulative committed ₹
  remaining: number;   // remaining ₹
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
