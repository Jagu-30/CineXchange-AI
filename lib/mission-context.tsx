'use client';

import {
  createContext,
  useCallback,
  useContext,
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
} from './types';

interface MissionContextValue {
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

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export function MissionProvider({ children }: { children: ReactNode }) {
  const [scenario] = useState<Scenario>(SCENARIO);
  const [agents, setAgents] = useState<Agent[]>(() =>
    AGENTS.map((a) => ({ ...a })),
  );
  const [activity, setActivity] = useState<ActivityEvent[]>(() =>
    INITIAL_ACTIVITY.map((a) => ({ ...a })),
  );
  const [requirements] = useState<RequirementItem[]>(() =>
    REQUIREMENTS.map((r) => ({ ...r })),
  );
  const [approvals, setApprovals] = useState<PendingApproval[]>(() => [
    { ...INSURANCE_APPROVAL, options: INSURANCE_APPROVAL.options.map((o) => ({ ...o })) },
  ]);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const pushActivity = useCallback((ev: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const event: ActivityEvent = {
      ...ev,
      id: nextId('act'),
      timestamp: new Date().toISOString(),
    };
    setActivity((prev) => [event, ...prev]);
  }, []);

  const setAgentStatus = useCallback((id: AgentId, status: AgentStatus) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a)),
    );
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

  const value = useMemo<MissionContextValue>(
    () => ({
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
    [scenario, agents, activity, requirements, approvals, pushActivity, setAgentStatus, resolveApproval, addApproval],
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error('useMission must be used within MissionProvider');
  return ctx;
}

// Shared helpers for formatting currency — used across components.
export function formatINR(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + n.toLocaleString('en-IN');
}

export function formatINRLakh(n: number): string {
  return '₹' + (n / 100000).toFixed(2) + 'L';
}
