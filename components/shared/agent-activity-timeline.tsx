'use client';

import type { JsonObject, PipelineStepName, StepStatus, StepStreamEvent, TraceEntry } from '@/lib/types';
import { PIPELINE_STEP_NAMES } from '@/lib/types';
import {
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
  Cpu,
  Clock,
  CheckCircle2,
  XCircle,
  Flag,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Known actors as documented on TraceEntry.actor: "producer | orchestrator |
// producer-agent | scout-agent | negotiation-agent | ...". The list is not
// closed — any actor not below falls back to a generic icon with its raw name,
// never a guessed label.
const AGENT_CONFIG: Record<string, { name: string; icon: any; color: string; bg: string }> = {
  producer: { name: 'Producer', icon: Brain, color: 'text-amberx', bg: 'bg-amberx/10' },
  'producer-agent': { name: 'Producer Agent', icon: Brain, color: 'text-amberx', bg: 'bg-amberx/10' },
  orchestrator: { name: 'Orchestrator', icon: Cpu, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  'scout-agent': { name: 'Marketplace Scout', icon: Search, color: 'text-bluex', bg: 'bg-bluex/10' },
  'negotiation-agent': { name: 'Negotiation Agent', icon: Handshake, color: 'text-amberx', bg: 'bg-amberx/10' },
  'compliance-agent': { name: 'Compliance Agent', icon: ShieldCheck, color: 'text-greenx', bg: 'bg-greenx/10' },
  'recovery-agent': { name: 'Recovery Agent', icon: Siren, color: 'text-redx', bg: 'bg-redx/10' },
};

// Themed on the backend's real StepStatus values only. There is no invented
// "successful" / "approval_required" / "blocked" default — a trace entry with
// no matching step simply renders without a status badge.
const STATUS_THEME: Record<StepStatus, { label: string; text: string; bg: string; border: string; icon: any }> = {
  in_progress: { label: 'In Progress', text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/30', icon: Clock },
  done: { label: 'Done', text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/30', icon: CheckCircle2 },
  failed: { label: 'Failed', text: 'text-redx', bg: 'bg-redx/10', border: 'border-redx/30', icon: XCircle },
  terminal: { label: 'Terminal', text: 'text-ink-text-secondary', bg: 'bg-ink-surface/60', border: 'border-ink-border', icon: Flag },
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function stringArrayField(payload: JsonObject, key: string): string[] | null {
  const v = payload[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

function stringField(payload: JsonObject, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' ? v : null;
}

function isPipelineStepName(action: string): action is PipelineStepName {
  return (PIPELINE_STEP_NAMES as readonly string[]).includes(action);
}

/**
 * Looks up a status for a trace entry only when its `action` exactly names a
 * pipeline step (e.g. `action === 'negotiate'`) and a matching event exists in
 * `steps` — the one join the backend actually supports. Any other entry (offer
 * created, negotiation round, approval decided, ...) has no step to join to and
 * intentionally gets no status badge.
 */
function statusFor(entry: TraceEntry, steps: StepStreamEvent[]): StepStatus | null {
  if (!isPipelineStepName(entry.action)) return null;
  let latest: StepStreamEvent | null = null;
  for (const s of steps) {
    if (s.name === entry.action && (!latest || s.seq > latest.seq)) latest = s;
  }
  return latest ? latest.status : null;
}

export interface AgentActivityTimelineProps {
  /** Real agent/orchestrator actions, from GET /productions/{id}/trace. Empty is a legitimate "nothing yet" state. */
  entries: TraceEntry[];
  /** Live step events, e.g. useMission().steps. Optional — used only to resolve a status for step-named entries. */
  steps?: StepStreamEvent[];
  className?: string;
}

export function AgentActivityTimeline({ entries, steps = [], className = '' }: AgentActivityTimelineProps) {
  if (!entries || entries.length === 0) {
    return (
      <div className="glass rounded-xl p-8 text-center border-dashed border-ink-border">
        <Cpu className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
        <div className="text-[13px] font-medium text-ink-text-secondary">No agent activity logged yet</div>
        <p className="text-[11px] text-ink-text-tertiary mt-1">
          Agent and orchestrator actions will stream here as this production runs.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {entries.map((entry, i) => {
        const agentKey = (entry.actor || '').toLowerCase();
        const agentCfg = AGENT_CONFIG[agentKey] || {
          name: entry.actor || 'Unknown actor',
          icon: Cpu,
          color: 'text-ink-text-secondary',
          bg: 'bg-ink-surface/60',
        };
        const AgentIcon = agentCfg.icon;

        const status = statusFor(entry, steps);
        const statusCfg = status ? STATUS_THEME[status] : null;
        const StatusIcon = statusCfg?.icon;

        const isLatest = i === entries.length - 1;

        // Best-effort, never-invented: surfaced only when the free-form payload
        // happens to carry these conventional keys (payload has no guaranteed
        // key set — see TraceEntry.payload). Absent almost always.
        const policyChecks = stringArrayField(entry.payload, 'policy_checks');
        const warnings = stringArrayField(entry.payload, 'warnings');
        const nextAction = stringField(entry.payload, 'next_action');

        return (
          <div
            key={`${entry.entity_type}-${entry.entity_id ?? 'none'}-${entry.ts}-${i}`}
            className={cn(
              'glass card-hover rounded-xl p-5 border transition-all',
              statusCfg?.border || 'border-ink-border',
              isLatest && 'animate-slide-in shadow-lg shadow-black/40',
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-ink-border/50 pb-3">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', agentCfg.bg)}>
                  <AgentIcon className={cn('h-4.5 w-4.5', agentCfg.color)} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-text-primary">{agentCfg.name}</span>
                    <span className="mono text-[10px] text-ink-text-tertiary">[{entry.action}]</span>
                  </div>
                  <div className="mono text-[10px] text-ink-text-tertiary mt-0.5" suppressHydrationWarning>
                    {formatTimestamp(entry.ts)}
                    {entry.entity_type && entry.entity_id && (
                      <> · {entry.entity_type}: {entry.entity_id.slice(0, 8)}</>
                    )}
                  </div>
                </div>
              </div>

              {statusCfg && StatusIcon && (
                <span
                  className={cn(
                    'mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shrink-0',
                    statusCfg.bg,
                    statusCfg.text,
                  )}
                >
                  <StatusIcon className="h-3 w-3" />
                  {statusCfg.label}
                </span>
              )}
            </div>

            {/* Policy checks — present only if the payload happens to carry them */}
            {policyChecks && policyChecks.length > 0 && (
              <div className="mt-3 rounded-lg bg-ink-surface/50 p-2.5 border border-ink-border/40">
                <div className="mono text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Policy Evaluations
                </div>
                <ul className="space-y-1">
                  {policyChecks.map((check, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-[11px] text-ink-text-secondary">
                      <span className="text-greenx text-[10px] mt-0.5">✓</span>
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings — present only if the payload happens to carry them */}
            {warnings && warnings.length > 0 && (
              <div className="mt-2.5 rounded-lg bg-redx/10 p-2.5 border border-redx/25">
                <div className="mono text-[9px] uppercase tracking-[0.14em] text-redx font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Warnings & Constraints
                </div>
                <ul className="space-y-1">
                  {warnings.map((warn, idx) => (
                    <li key={idx} className="text-[11px] text-redx/90 leading-snug">
                      • {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next action — present only if the payload happens to carry it */}
            {nextAction && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-amberx font-medium">
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span>Next: {nextAction}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
