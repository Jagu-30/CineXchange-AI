'use client';

import { useState } from 'react';
import { useMission } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import type { AuditLogEntry } from '@/lib/types';
import {
  FileText,
  Filter,
  Code,
  Download,
  RotateCw,
  Cpu,
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function AuditPageContent() {
  const { productionState, refreshState, isLoading } = useMission();
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [showRawJson, setShowRawJson] = useState(false);

  const rawEntries: AuditLogEntry[] = productionState?.audit_log || [];

  const filteredEntries = rawEntries.filter((e) => {
    if (selectedAgent !== 'ALL' && (e.agent || '').toLowerCase() !== selectedAgent.toLowerCase()) {
      return false;
    }
    if (selectedStatus !== 'ALL' && (e.status || '').toLowerCase() !== selectedStatus.toLowerCase()) {
      return false;
    }
    return true;
  });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Audit Governance Trail</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <FileText className="h-6 w-6 text-amberx" />
            Agent Activity Timeline & Audit Log
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Immutable chronological audit log capturing every decision, multi-criteria score, deterministic policy check, and state transition.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong transition-all"
          >
            <Code className="h-4 w-4" />
            {showRawJson ? 'Hide State JSON' : 'Inspect Production State JSON'}
          </button>

          <button
            onClick={() => refreshState()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-amberx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all disabled:opacity-50"
          >
            <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin-slow')} />
            Refresh Audit Log
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Audit" />

      {/* Raw State JSON Inspector Modal/Panel */}
      {showRawJson && (
        <div className="glass-strong rounded-2xl p-6 border border-amberx/30 glow-amber space-y-3 animate-slide-in">
          <div className="flex items-center justify-between border-b border-ink-border/50 pb-2.5">
            <div className="flex items-center gap-2 font-semibold text-[14px] text-amberx">
              <Code className="h-4 w-4" />
              Shared In-Memory Production State (JSON)
            </div>
            <span className="mono text-[11px] text-ink-text-tertiary">
              Current State: {productionState?.current_state || 'DRAFT'}
            </span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-xl bg-ink-surface p-4 text-[11.5px] font-mono text-ink-text-primary border border-ink-border">
            {JSON.stringify(productionState, null, 2)}
          </pre>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass rounded-2xl p-4 border border-ink-border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-wider text-ink-text-tertiary mr-1 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Filter Agent:
          </span>
          {[
            { id: 'ALL', label: 'All Agents' },
            { id: 'producer', label: 'Producer' },
            { id: 'scout', label: 'Scout' },
            { id: 'negotiation', label: 'Negotiation' },
            { id: 'compliance', label: 'Compliance' },
            { id: 'recovery', label: 'Recovery' },
          ].map((ag) => (
            <button
              key={ag.id}
              onClick={() => setSelectedAgent(ag.id)}
              className={cn(
                'rounded-lg px-3 py-1 text-[11.5px] transition-all',
                selectedAgent === ag.id
                  ? 'bg-amberx text-ink-bg font-semibold'
                  : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/60',
              )}
            >
              {ag.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-wider text-ink-text-tertiary">Status:</span>
          {['ALL', 'successful', 'approval_required', 'blocked', 'failed'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={cn(
                'mono rounded-lg px-2.5 py-1 text-[10.5px] uppercase transition-all',
                selectedStatus === st
                  ? 'bg-ink-raised text-amberx border border-amberx/30 font-bold'
                  : 'text-ink-text-tertiary hover:text-ink-text-secondary',
              )}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="glass rounded-2xl p-7 border border-ink-border space-y-4">
        <div className="flex items-center justify-between mb-2">
          <span className="mono text-[11px] text-ink-text-tertiary">
            Showing {filteredEntries.length} of {rawEntries.length} logged events
          </span>
          <span className="mono text-[10px] text-greenx">TAMPER-EVIDENT LOG</span>
        </div>

        <AgentActivityTimeline entries={filteredEntries} />
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <AppShell>
      <AuditPageContent />
    </AppShell>
  );
}
