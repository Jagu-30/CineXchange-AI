'use client';

import { useMemo } from 'react';
import type { AuditLogEntry } from '@/lib/types';
import {
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
  Cpu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AGENT_CONFIG: Record<string, { name: string; icon: any; color: string; bg: string }> = {
  producer: { name: 'Producer Agent', icon: Brain, color: 'text-amberx', bg: 'bg-amberx/10' },
  scout: { name: 'Marketplace Scout', icon: Search, color: 'text-bluex', bg: 'bg-bluex/10' },
  negotiation: { name: 'Negotiation Agent', icon: Handshake, color: 'text-amberx', bg: 'bg-amberx/10' },
  compliance: { name: 'Compliance Agent', icon: ShieldCheck, color: 'text-greenx', bg: 'bg-greenx/10' },
  recovery: { name: 'Recovery Agent', icon: Siren, color: 'text-redx', bg: 'bg-redx/10' },
  policy_engine: { name: 'Policy Engine', icon: Cpu, color: 'text-purple-400', bg: 'bg-purple-500/10' },
};

const STATUS_THEME: Record<string, { label: string; text: string; bg: string; border: string; icon: any }> = {
  processing: {
    label: 'Processing',
    text: 'text-bluex',
    bg: 'bg-bluex/10',
    border: 'border-bluex/30',
    icon: Clock,
  },
  successful: {
    label: 'Successful',
    text: 'text-greenx',
    bg: 'bg-greenx/10',
    border: 'border-greenx/30',
    icon: CheckCircle2,
  },
  approval_required: {
    label: 'Approval Required',
    text: 'text-amberx',
    bg: 'bg-amberx/10',
    border: 'border-amberx/30',
    icon: AlertTriangle,
  },
  blocked: {
    label: 'Blocked',
    text: 'text-redx',
    bg: 'bg-redx/10',
    border: 'border-redx/30',
    icon: ShieldAlert,
  },
  failed: {
    label: 'Failed',
    text: 'text-redx',
    bg: 'bg-redx/10',
    border: 'border-redx/30',
    icon: XCircle,
  },
  recommendation: {
    label: 'Recommendation',
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    icon: HelpCircle,
  },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function AgentActivityTimeline({
  entries,
  className = '',
}: {
  entries: AuditLogEntry[];
  className?: string;
}) {
  if (!entries || entries.length === 0) {
    return (
      <div className="glass rounded-xl p-8 text-center border-dashed border-ink-border">
        <Cpu className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
        <div className="text-[13px] font-medium text-ink-text-secondary">No agent activity logged yet</div>
        <p className="text-[11px] text-ink-text-tertiary mt-1">Actions from the 5 AI agents will stream here in real-time.</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {entries.map((entry, i) => {
        const agentKey = (entry.agent || '').toLowerCase();
        const agentCfg = AGENT_CONFIG[agentKey] || {
          name: entry.agent_name || 'Policy Engine',
          icon: Cpu,
          color: 'text-amberx',
          bg: 'bg-amberx/10',
        };
        const AgentIcon = agentCfg.icon;

        const statusKey = (entry.status || 'successful').toLowerCase();
        const statusCfg = STATUS_THEME[statusKey] || STATUS_THEME.successful;
        const StatusIcon = statusCfg.icon;

        const isLatest = i === 0;

        return (
          <div
            key={entry.entry_id || i}
            className={cn(
              'glass card-hover rounded-xl p-5 border transition-all',
              statusCfg.border,
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
                    <span className="text-[13px] font-semibold text-ink-text-primary">
                      {entry.agent_name || agentCfg.name}
                    </span>
                    <span className="mono text-[10px] text-ink-text-tertiary">
                      [{entry.action}]
                    </span>
                  </div>
                  <div className="mono text-[10px] text-ink-text-tertiary mt-0.5" suppressHydrationWarning>
                    {formatTimestamp(entry.timestamp)} · ID: {entry.entry_id}
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <span
                className={cn(
                  'mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider',
                  statusCfg.bg,
                  statusCfg.text,
                )}
              >
                <StatusIcon className="h-3 w-3" />
                {statusCfg.label}
              </span>
            </div>

            {/* Summaries */}
            <div className="mt-3 space-y-2 text-[12px]">
              {entry.input_summary && (
                <div className="flex gap-2">
                  <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary shrink-0 w-16">
                    Input:
                  </span>
                  <span className="text-ink-text-secondary leading-relaxed font-mono text-[11.5px]">
                    {entry.input_summary}
                  </span>
                </div>
              )}

              {entry.output_summary && (
                <div className="flex gap-2">
                  <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary shrink-0 w-16">
                    Output:
                  </span>
                  <span className="text-ink-text-primary leading-relaxed font-medium">
                    {entry.output_summary}
                  </span>
                </div>
              )}
            </div>

            {/* Policy Checks */}
            {entry.policy_checks && entry.policy_checks.length > 0 && (
              <div className="mt-3 rounded-lg bg-ink-surface/50 p-2.5 border border-ink-border/40">
                <div className="mono text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Policy Evaluations
                </div>
                <ul className="space-y-1">
                  {entry.policy_checks.map((check, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-[11px] text-ink-text-secondary">
                      <span className="text-greenx text-[10px] mt-0.5">✓</span>
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings / Blockers */}
            {entry.warnings && entry.warnings.length > 0 && (
              <div className="mt-2.5 rounded-lg bg-redx/10 p-2.5 border border-redx/25">
                <div className="mono text-[9px] uppercase tracking-[0.14em] text-redx font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Warnings & Constraints
                </div>
                <ul className="space-y-1">
                  {entry.warnings.map((warn, idx) => (
                    <li key={idx} className="text-[11px] text-redx/90 leading-snug">
                      • {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next Action */}
            {entry.next_action && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-amberx font-medium">
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span>Next: {entry.next_action}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
