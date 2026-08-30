'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMission } from '@/lib/mission-context';
import { apiClient, isApiError } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import type { PipelineStepName, StepStatus, StepStreamEvent, TraceEntry, TraceResponse } from '@/lib/types';
import { PIPELINE_STEP_NAMES } from '@/lib/types';
import { FileText, Filter, Code, RotateCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS: StepStatus[] = ['in_progress', 'done', 'failed', 'terminal'];

// Mirrors AgentActivityTimeline's own join (that component does not export it),
// so the status filter here matches exactly what the timeline badges below it.
function isPipelineStepName(action: string): action is PipelineStepName {
  return (PIPELINE_STEP_NAMES as readonly string[]).includes(action);
}

function statusFor(entry: TraceEntry, steps: StepStreamEvent[]): StepStatus | null {
  if (!isPipelineStepName(entry.action)) return null;
  let latest: StepStreamEvent | null = null;
  for (const s of steps) {
    if (s.name === entry.action && (!latest || s.seq > latest.seq)) latest = s;
  }
  return latest ? latest.status : null;
}

function actorLabel(actor: string): string {
  return actor
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function AuditPageContent() {
  const { productionId, steps } = useMission();

  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [showRawJson, setShowRawJson] = useState(false);

  const fetchTrace = useCallback(async () => {
    if (!productionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getTrace(productionId);
      setTrace(res);
    } catch (err) {
      setError(
        isApiError(err)
          ? err.detail || err.message
          : err instanceof Error
            ? err.message
            : 'Could not load the audit trace.',
      );
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    void fetchTrace();
  }, [fetchTrace]);

  const entries: TraceEntry[] = trace?.trace ?? [];
  const actors = trace?.actors ?? [];

  const filteredEntries = entries.filter((e) => {
    if (selectedAgent !== 'ALL' && e.actor !== selectedAgent) return false;
    if (selectedStatus !== 'ALL' && statusFor(e, steps) !== selectedStatus) return false;
    return true;
  });

  if (!productionId) {
    return (
      <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
        <div className="glass rounded-2xl p-10 text-center border-dashed border-ink-border">
          <FileText className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
          <div className="text-[14px] font-medium text-ink-text-secondary">No production selected</div>
          <p className="text-[12px] text-ink-text-tertiary mt-1">
            Start or select a production run to see its audit trail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="mono text-[10px] text-ink-text-tertiary">Audit Trail</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <FileText className="h-6 w-6 text-amberx" />
            Agent Activity Timeline & Audit Log
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Every recorded action for this production, in order, from GET /productions/{'{id}'}/trace.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong transition-all"
          >
            <Code className="h-4 w-4" />
            {showRawJson ? 'Hide Trace JSON' : 'Inspect Trace JSON'}
          </button>

          <button
            onClick={() => void fetchTrace()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-amberx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all disabled:opacity-50"
          >
            <RotateCw className={cn('h-4 w-4', loading && 'animate-spin-slow')} />
            Refresh Audit Log
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Audit" />

      {error && (
        <div className="rounded-xl p-4 border border-redx/30 bg-redx/10 text-redx flex items-start gap-2.5 text-[12.5px]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Raw Trace JSON Inspector */}
      {showRawJson && (
        <div className="glass-strong rounded-2xl p-6 border border-amberx/30 glow-amber space-y-3 animate-slide-in">
          <div className="flex items-center justify-between border-b border-ink-border/50 pb-2.5">
            <div className="flex items-center gap-2 font-semibold text-[14px] text-amberx">
              <Code className="h-4 w-4" />
              Raw Trace Response (JSON)
            </div>
            <span className="mono text-[11px] text-ink-text-tertiary">
              {trace ? `${trace.entries} entries` : 'not loaded'}
            </span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-xl bg-ink-surface p-4 text-[11.5px] font-mono text-ink-text-primary border border-ink-border">
            {JSON.stringify(trace, null, 2)}
          </pre>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass rounded-2xl p-4 border border-ink-border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-wider text-ink-text-tertiary mr-1 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Filter Actor:
          </span>
          {['ALL', ...actors].map((actor) => (
            <button
              key={actor}
              onClick={() => setSelectedAgent(actor)}
              className={cn(
                'rounded-lg px-3 py-1 text-[11.5px] transition-all',
                selectedAgent === actor
                  ? 'bg-amberx text-ink-bg font-semibold'
                  : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/60',
              )}
            >
              {actor === 'ALL' ? 'All Actors' : actorLabel(actor)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-wider text-ink-text-tertiary">Step Status:</span>
          {['ALL', ...STATUS_OPTIONS].map((st) => (
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
            Showing {filteredEntries.length} of {entries.length} logged events
          </span>
          <span className="mono text-[10px] text-greenx">APPEND-ONLY LOG</span>
        </div>

        <AgentActivityTimeline entries={filteredEntries} steps={steps} />
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
