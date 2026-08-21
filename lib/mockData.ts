import type {
  Agent,
  ActivityEvent,
  BudgetSnapshot,
  PendingApproval,
  ProcurementStep,
  RequirementItem,
  Scenario,
  VendorOption,
} from './types';

export const SCENARIO: Scenario = {
  title: 'Rainforest Night Shoot — Agumbe',
  summary:
    '2 low-light rainforest scenes · 3-day shoot · ₹25.00L budget cap',
  description:
    'Two low-light rainforest scenes for a wildlife documentary series, shot over 3 consecutive days in the Agumbe rainforest belt. Requires low-light camera bodies, heavy fog-resistant lighting, silent generators, a licensed drone pilot with forest clearance, on-site insurance covering equipment and crew, transport for a 14-person crew from Bengaluru, and forest department permits for after-hours filming in a protected zone.',
  budgetCap: 2500000,
  shootDays: 3,
};

export const AGENTS: Agent[] = [
  {
    id: 'producer',
    name: 'Producer Agent',
    role: 'Mission control',
    description:
      'Breaks the shoot brief into production requirements and orchestrates the other agents.',
    status: 'done',
  },
  {
    id: 'scout',
    name: 'Marketplace Scout Agent',
    role: 'Vendor discovery',
    description:
      'Searches the simulated vendor marketplace and requests offers across all categories.',
    status: 'done',
  },
  {
    id: 'negotiation',
    name: 'Negotiation Agent',
    role: 'Price & bundles',
    description:
      'Negotiates improved unit prices, multi-day bundles, and package discounts with vendors.',
    status: 'waiting_approval',
  },
  {
    id: 'compliance',
    name: 'Compliance & Approval Agent',
    role: 'Permits & records',
    description:
      'Checks availability, permits, insurance coverage, and delivery windows; requests producer approval.',
    status: 'waiting_approval',
  },
  {
    id: 'recovery',
    name: 'Emergency Recovery Agent',
    role: 'On-call resilience',
    description:
      'Monitors delivery and on-site status; auto-recovers from failures by re-sourcing and re-negotiating.',
    status: 'idle',
  },
];

export const REQUIREMENTS: RequirementItem[] = [
  {
    id: 'req-cam-01',
    category: 'Camera',
    itemName: 'ARRI Alexa Mini LF + 2x Sigma primes',
    vendor: 'LightForge Rentals',
    originalPrice: 480000,
    negotiatedPrice: 412000,
    status: 'confirmed',
  },
  {
    id: 'req-cam-02',
    category: 'Camera',
    itemName: 'B-camera body (Sony FX9) + gimbal',
    vendor: 'LightForge Rentals',
    originalPrice: 185000,
    negotiatedPrice: 162000,
    status: 'confirmed',
  },
  {
    id: 'req-drn-01',
    category: 'Drone',
    itemName: 'DJI Inspire 3 + licensed pilot',
    vendor: 'Skyline Aerials',
    originalPrice: 220000,
    negotiatedPrice: 198000,
    status: 'confirmed',
  },
  {
    id: 'req-lgt-01',
    category: 'Lighting',
    itemName: 'Astera Titan tubes x12 + fog machine',
    vendor: 'GlowLab Studio',
    originalPrice: 310000,
    negotiatedPrice: 276000,
    status: 'confirmed',
  },
  {
    id: 'req-gen-01',
    category: 'Generator',
    itemName: 'Silent 15kVA diesel generator + fuel',
    vendor: 'PowerHaul Co.',
    originalPrice: 145000,
    negotiatedPrice: 128000,
    status: 'confirmed',
  },
  {
    id: 'req-plt-01',
    category: 'Pilot',
    itemName: 'DGCA-licensed drone pilot (3 days)',
    vendor: 'Skyline Aerials',
    originalPrice: 90000,
    negotiatedPrice: 81000,
    status: 'confirmed',
  },
  {
    id: 'req-ins-01',
    category: 'Insurance',
    itemName: 'On-shoot equipment + crew cover',
    vendor: null,
    originalPrice: null,
    negotiatedPrice: null,
    status: 'negotiating',
  },
  {
    id: 'req-trn-01',
    category: 'Transport',
    itemName: 'Crew van + equipment truck (3 days)',
    vendor: 'FleetWorks Logistics',
    originalPrice: 165000,
    negotiatedPrice: 142000,
    status: 'confirmed',
  },
  {
    id: 'req-prm-01',
    category: 'Permit',
    itemName: 'Forest dept. after-hours filming permit',
    vendor: 'Karnataka Forest Dept.',
    originalPrice: 38000,
    negotiatedPrice: 38000,
    status: 'confirmed',
  },
];

export const INSURANCE_OPTIONS: VendorOption[] = [
  {
    id: 'opt-ins-a',
    rank: 1,
    vendorName: 'SetGuard Insurance',
    reasoning:
      'Covers equipment + crew + weather delay, fastest claim SLA in network',
    price: 78000,
    deliveryTime: 'Policy issued in 4 hrs',
    rating: 4.7,
    recommended: true,
  },
  {
    id: 'opt-ins-b',
    rank: 2,
    vendorName: 'FrameSafe Brokers',
    reasoning: 'Lower premium but excludes weather-delay payout',
    price: 64000,
    deliveryTime: 'Policy issued in 8 hrs',
    rating: 4.2,
  },
  {
    id: 'opt-ins-c',
    rank: 3,
    vendorName: 'OnLocation Cover',
    reasoning: 'Premium plan, on-site adjuster, but 24h issuance',
    price: 92000,
    deliveryTime: 'Policy issued in 24 hrs',
    rating: 4.5,
  },
];

export const INSURANCE_APPROVAL: PendingApproval = {
  id: 'appr-ins-01',
  kind: 'insurance',
  title: 'Insurance vendor selection',
  context:
    'Compliance Agent needs a producer decision on the rainforest shoot insurance package. Recommended option balances coverage, claim speed, and cost.',
  options: INSURANCE_OPTIONS,
};

export const BUDGET_SNAPSHOTS: BudgetSnapshot[] = [
  { label: 'T-0', committed: 0, remaining: 2500000 },
  { label: '+2h', committed: 412000, remaining: 2088000 },
  { label: '+5h', committed: 574000, remaining: 1926000 },
  { label: '+8h', committed: 772000, remaining: 1728000 },
  { label: 'Day 1', committed: 1048000, remaining: 1452000 },
  { label: 'Day 2', committed: 1387000, remaining: 1113000 },
  { label: 'Day 3', committed: 1449000, remaining: 1051000 },
];

export const PROCUREMENT_STEPS: ProcurementStep[] = [
  {
    step: 1,
    title: 'Break request into production requirements',
    agent: 'producer',
    agentName: 'Producer Agent',
    description:
      'Parse the free-text shoot brief into 8 requirement categories with quantity, duration, and constraints.',
  },
  {
    step: 2,
    title: 'Search simulated vendors',
    agent: 'scout',
    agentName: 'Marketplace Scout Agent',
    description:
      'Query the vendor marketplace for available providers within range and specialty for each category.',
  },
  {
    step: 3,
    title: 'Ask vendor agents for offers',
    agent: 'scout',
    agentName: 'Marketplace Scout Agent',
    description:
      'Send offer requests to shortlisted vendors and collect quotes with pricing and availability.',
  },
  {
    step: 4,
    title: 'Negotiate improved prices & bundles',
    agent: 'negotiation',
    agentName: 'Negotiation Agent',
    description:
      'Push back on unit rates, propose multi-day and multi-category bundles, lock in discounts.',
  },
  {
    step: 5,
    title: 'Check availability, permits, insurance, delivery time',
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    description:
      'Validate that every shortlisted vendor can actually deliver on the shoot dates with paperwork in order.',
  },
  {
    step: 6,
    title: 'Compare total cost & creative suitability',
    agent: 'producer',
    agentName: 'Producer Agent',
    description:
      'Score packages on cost, reliability, and creative fit against the shoot brief.',
  },
  {
    step: 7,
    title: 'Recommend the best package',
    agent: 'negotiation',
    agentName: 'Negotiation Agent',
    description:
      'Rank vendor options and surface the recommended package with reasoning.',
  },
  {
    step: 8,
    title: 'Request producer approval',
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    description:
      'Present the ranked approval card to the producer and wait for a decision.',
  },
  {
    step: 9,
    title: 'Create booking & procurement record',
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    description:
      'On approval, generate booking records, confirm with vendors, and log the commitment.',
  },
  {
    step: 10,
    title: 'Monitor delivery, recover automatically',
    agent: 'recovery',
    agentName: 'Emergency Recovery Agent',
    description:
      'Watch on-site status; if a vendor fails, auto-source a replacement and renegotiate within the cost envelope.',
  },
];

export const INITIAL_ACTIVITY: ActivityEvent[] = [
  {
    id: 'act-001',
    timestamp: '2026-08-21T10:18:00.000Z',
    agent: 'producer',
    agentName: 'Producer Agent',
    message: 'Shoot brief parsed into 8 requirement categories across 3 shoot days.',
    type: 'info',
  },
  {
    id: 'act-002',
    timestamp: '2026-08-21T10:22:00.000Z',
    agent: 'scout',
    agentName: 'Marketplace Scout Agent',
    message: 'Found 23 vendors in range across 8 categories; shortlisted 11 for offers.',
    type: 'info',
  },
  {
    id: 'act-003',
    timestamp: '2026-08-21T10:29:00.000Z',
    agent: 'scout',
    agentName: 'Marketplace Scout Agent',
    message: 'Offers received from 9 vendors. 2 categories need negotiation.',
    type: 'success',
  },
  {
    id: 'act-004',
    timestamp: '2026-08-21T10:36:00.000Z',
    agent: 'negotiation',
    agentName: 'Negotiation Agent',
    message: 'Camera bundle negotiated: 14% off on 2-body package with LightForge.',
    type: 'success',
  },
  {
    id: 'act-005',
    timestamp: '2026-08-21T10:42:00.000Z',
    agent: 'negotiation',
    agentName: 'Negotiation Agent',
    message: 'Lighting + generator bundled across GlowLab and PowerHaul — saved ₹51,000.',
    type: 'success',
  },
  {
    id: 'act-006',
    timestamp: '2026-08-21T10:49:00.000Z',
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    message: 'Forest permit confirmed for after-hours filming. Insurance pending producer decision.',
    type: 'warning',
  },
  {
    id: 'act-007',
    timestamp: '2026-08-21T10:56:00.000Z',
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    message: 'Insurance vendor selection requires producer approval — 3 quotes ranked.',
    type: 'approval',
  },
];

// Recovery demo scripted sequence — messages pushed with staggered delays.
export const RECOVERY_SCRIPT: Omit<ActivityEvent, 'id' | 'timestamp'>[] = [
  {
    agent: 'recovery',
    agentName: 'Emergency Recovery Agent',
    message: 'ALERT — On-site telemetry: ARRI Alexa Mini LF reported sensor failure at camera position A.',
    type: 'warning',
  },
  {
    agent: 'recovery',
    agentName: 'Emergency Recovery Agent',
    message: 'Scanning vendors within 40km radius for replacement cinema camera body…',
    type: 'info',
  },
  {
    agent: 'scout',
    agentName: 'Marketplace Scout Agent',
    message: 'Found 2 available ARRI Alexa Mini LF bodies within 40km — Bengaluru node.',
    type: 'info',
  },
  {
    agent: 'recovery',
    agentName: 'Emergency Recovery Agent',
    message: 'Replacement located: CineCore Rentals — ₹46,000/day, 2hr delivery to site.',
    type: 'warning',
  },
  {
    agent: 'negotiation',
    agentName: 'Negotiation Agent',
    message: 'Negotiated replacement down to ₹39,000/day with 3-day bundle commitment.',
    type: 'success',
  },
  {
    agent: 'recovery',
    agentName: 'Emergency Recovery Agent',
    message: 'Schedule impact: zero delay. Replacement arrives before call time tomorrow.',
    type: 'success',
  },
  {
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    message: 'Insurance rider updated. Logistics rerouted to new pickup point.',
    type: 'info',
  },
  {
    agent: 'compliance',
    agentName: 'Compliance & Approval Agent',
    message: 'Producer approval required for cost delta of ₹15,000 over original camera line.',
    type: 'approval',
  },
];

export const RECOVERY_COST_DELTA_APPROVAL: PendingApproval = {
  id: 'appr-rec-01',
  kind: 'cost_delta',
  title: 'Recovery cost delta approval',
  context:
    'Emergency Recovery Agent sourced a replacement camera body after on-site failure. The new vendor is ₹15,000 above the original camera line. Approve to commit the delta against the budget.',
  costDelta: 15000,
  options: [
    {
      id: 'opt-rec-a',
      rank: 1,
      vendorName: 'CineCore Rentals',
      reasoning: 'Fastest replacement, 2hr delivery, 3-day bundle negotiated',
      price: 117000,
      deliveryTime: '2 hr delivery',
      rating: 4.4,
      recommended: true,
    },
  ],
};
