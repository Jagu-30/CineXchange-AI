'use client';

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
import {
  AGENTS,
  INITIAL_ACTIVITY,
  INSURANCE_APPROVAL,
  REQUIREMENTS,
  SCENARIO,
} from './mockData';
import type {
  ActivityEvent,
  Agent,
  AgentId,
  AgentStatus,
  PendingApproval,
  RequirementItem,
  Scenario,
  ProductionState,
  ProjectInput,
  AuditLogEntry,
  WorkflowState,
} from './types';
import { apiClient } from './api-client';

interface MissionContextValue {
  // Primary state
  productionState: ProductionState | null;
  isLoading: boolean;
  error: string | null;
  activeProjectId: string;
  refreshState: () => Promise<void>;

  // Agent workflow action triggers
  planProject: (input?: Partial<ProjectInput>) => Promise<ProductionState | null>;
  runScout: () => Promise<ProductionState | null>;
  startNegotiation: (vendorId?: string, resourceId?: string) => Promise<ProductionState | null>;
  submitCounterOffer: (negId: string, price: number, terms?: any) => Promise<ProductionState | null>;
  acceptOffer: (negId: string) => Promise<ProductionState | null>;
  runCompliance: () => Promise<ProductionState | null>;
  approveDecision: (approvalId: string) => Promise<ProductionState | null>;
  rejectDecision: (approvalId: string) => Promise<ProductionState | null>;
  triggerIncident: (resourceId?: string, msg?: string) => Promise<ProductionState | null>;
  runRecovery: () => Promise<ProductionState | null>;
  approveRecovery: (optionId?: string) => Promise<ProductionState | null>;

  // Legacy compat bridge
  scenario: Scenario;
  agents: Agent[];
  activity: ActivityEvent[];
  requirements: RequirementItem[];
  approvals: PendingApproval[];
  pushActivity: (ev: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  setAgentStatus: (id: AgentId, status: AgentStatus) => void;
  resolveApproval: (
    approvalId: string,
    resolution: 'selected' | 'waitlisted' | 'approved',
    selectedOptionId?: string,
  ) => void;
  addApproval: (approval: PendingApproval) => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

let idCounter = 2000;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export function MissionProvider({ children }: { children: ReactNode }) {
  const [activeProjectId] = useState('PROJ-001');
  const [productionState, setProductionState] = useState<ProductionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Legacy state
  const [scenario] = useState<Scenario>(SCENARIO);
  const [agents, setAgents] = useState<Agent[]>(() => AGENTS.map((a) => ({ ...a })));
  const [activity, setActivity] = useState<ActivityEvent[]>(() => INITIAL_ACTIVITY.map((a) => ({ ...a })));
  const [requirements] = useState<RequirementItem[]>(() => REQUIREMENTS.map((r) => ({ ...r })));
  const [approvals, setApprovals] = useState<PendingApproval[]>(() => [
    { ...INSURANCE_APPROVAL, options: INSURANCE_APPROVAL.options.map((o) => ({ ...o })) },
  ]);

  const pushActivity = useCallback((ev: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const event: ActivityEvent = {
      ...ev,
      id: nextId('act'),
      timestamp: new Date().toISOString(),
    };
    setActivity((prev) => [event, ...prev]);
  }, []);

  const setAgentStatus = useCallback((id: AgentId, status: AgentStatus) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }, []);

  const resolveApproval = useCallback(
    (
      approvalId: string,
      resolution: 'selected' | 'waitlisted' | 'approved',
      selectedOptionId?: string,
    ) => {
      setApprovals((prev) =>
        prev.map((a) =>
          a.id === approvalId
            ? { ...a, resolved: true, resolution, selectedOptionId }
            : a,
        ),
      );
    },
    [],
  );

  const addApproval = useCallback((approval: PendingApproval) => {
    setApprovals((prev) => [approval, ...prev.filter((p) => p.id !== approval.id)]);
  }, []);

  // Sync state from backend
  const refreshState = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const state = await apiClient.getProjectState(activeProjectId);
      setProductionState(state);

      // Update legacy agents and activity if audit log has entries
      if (state.audit_log && state.audit_log.length > 0) {
        const mappedActivity: ActivityEvent[] = state.audit_log.slice(0, 15).map((a) => ({
          id: a.entry_id,
          timestamp: a.timestamp,
          agent: (a.agent as AgentId) || 'producer',
          agentName: a.agent_name || 'System Agent',
          message: `${a.action}: ${a.output_summary}`,
          type: a.status === 'blocked' ? 'warning' : a.status === 'approval_required' ? 'approval' : 'success',
        }));
        setActivity(mappedActivity);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync with backend');
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // Action: Plan project
  const planProject = useCallback(
    async (input?: Partial<ProjectInput>) => {
      try {
        setIsLoading(true);
        setError(null);
        setAgentStatus('producer', 'working');
        const defaultInput: ProjectInput = {
          project_id: activeProjectId,
          title: 'Rainforest Night Shoot',
          description: 'Two low-light rainforest scenes over three days.',
          producer_request:
            input?.producer_request ||
            'We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.',
          budget: input?.budget || 2500000,
          currency: 'INR',
          duration_days: input?.duration_days || 3,
          location: input?.location || 'Western Ghats rainforest',
        };
        const updated = await apiClient.createProjectPlan(defaultInput);
        setProductionState(updated);
        setAgentStatus('producer', 'done');
        return updated;
      } catch (err: any) {
        setError(err.message);
        setAgentStatus('producer', 'idle');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Run Scout
  const runScout = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setAgentStatus('scout', 'working');
      const updated = await apiClient.runScout(activeProjectId);
      setProductionState(updated);
      setAgentStatus('scout', 'done');
      return updated;
    } catch (err: any) {
      setError(err.message);
      setAgentStatus('scout', 'idle');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId, setAgentStatus]);

  // Action: Start Negotiation
  const startNegotiation = useCallback(
    async (vendorId: string = 'V003', resourceId: string = 'CAM-002') => {
      try {
        setIsLoading(true);
        setError(null);
        setAgentStatus('negotiation', 'working');
        const updated = await apiClient.startNegotiation(activeProjectId, vendorId, resourceId);
        setProductionState(updated);
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Submit Counter Offer
  const submitCounterOffer = useCallback(
    async (negId: string, price: number, terms?: any) => {
      try {
        setIsLoading(true);
        setError(null);
        setAgentStatus('negotiation', 'working');
        const updated = await apiClient.submitCounterOffer(activeProjectId, negId, {
          price,
          requested_terms: terms,
        });
        setProductionState(updated);
        setAgentStatus('negotiation', 'waiting_approval');
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Accept Offer
  const acceptOffer = useCallback(
    async (negId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const updated = await apiClient.acceptOffer(activeProjectId, negId);
        setProductionState(updated);
        setAgentStatus('negotiation', 'done');
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Run Compliance
  const runCompliance = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setAgentStatus('compliance', 'working');
      const updated = await apiClient.runCompliance(activeProjectId);
      setProductionState(updated);
      setAgentStatus('compliance', 'waiting_approval');
      return updated;
    } catch (err: any) {
      setError(err.message);
      setAgentStatus('compliance', 'idle');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId, setAgentStatus]);

  // Action: Approve Decision
  const approveDecision = useCallback(
    async (approvalId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const updated = await apiClient.approveDecision(activeProjectId, approvalId);
        setProductionState(updated);
        setAgentStatus('compliance', 'done');
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Reject Decision
  const rejectDecision = useCallback(
    async (approvalId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const updated = await apiClient.rejectDecision(activeProjectId, approvalId);
        setProductionState(updated);
        setAgentStatus('compliance', 'blocked');
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Trigger Incident
  const triggerIncident = useCallback(
    async (resourceId: string = 'CAM-001', msg: string = 'Booked camera became unavailable mid-shoot') => {
      try {
        setIsLoading(true);
        setError(null);
        setAgentStatus('recovery', 'alert');
        const updated = await apiClient.createIncident(activeProjectId, 'RESOURCE_UNAVAILABLE', resourceId, msg);
        setProductionState(updated);
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  // Action: Run Recovery
  const runRecovery = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setAgentStatus('recovery', 'working');
      const updated = await apiClient.runRecovery(activeProjectId);
      setProductionState(updated);
      setAgentStatus('recovery', 'waiting_approval');
      return updated;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId, setAgentStatus]);

  // Action: Approve Recovery
  const approveRecovery = useCallback(
    async (optionId: string = 'CAM-002') => {
      try {
        setIsLoading(true);
        setError(null);
        const updated = await apiClient.approveRecovery(activeProjectId, optionId);
        setProductionState(updated);
        setAgentStatus('recovery', 'done');
        return updated;
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeProjectId, setAgentStatus],
  );

  const value = useMemo<MissionContextValue>(
    () => ({
      productionState,
      isLoading,
      error,
      activeProjectId,
      refreshState,
      planProject,
      runScout,
      startNegotiation,
      submitCounterOffer,
      acceptOffer,
      runCompliance,
      approveDecision,
      rejectDecision,
      triggerIncident,
      runRecovery,
      approveRecovery,
      scenario,
      agents,
      activity,
      requirements,
      approvals,
      pushActivity,
      setAgentStatus,
      resolveApproval,
      addApproval,
    }),
    [
      productionState,
      isLoading,
      error,
      activeProjectId,
      refreshState,
      planProject,
      runScout,
      startNegotiation,
      submitCounterOffer,
      acceptOffer,
      runCompliance,
      approveDecision,
      rejectDecision,
      triggerIncident,
      runRecovery,
      approveRecovery,
      scenario,
      agents,
      activity,
      requirements,
      approvals,
      pushActivity,
      setAgentStatus,
      resolveApproval,
      addApproval,
    ],
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission(): MissionContextValue {
  const context = useContext(MissionContext);

  if (context === null) {
    throw new Error(
      'useMission must be used within MissionProvider. ' +
      'Ensure MissionProvider wraps the root layout or _app.'
    );
  }

  return context;
}

export function formatINR(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function formatINRLakh(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + (n / 100000).toFixed(2) + 'L';
}
