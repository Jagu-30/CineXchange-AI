'use client';

import { useState } from 'react';
import { useMission, formatINR, parseMoney } from '@/lib/mission-context';
import { apiClient, isAgentUnavailableError, isApiError, isConflictError } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import { ApprovalCard } from '@/components/shared/approval-card';
import type {
  ApprovalDecisionResponse,
  JsonObject,
  ProductionApproval,
  ProductionRecoveryEvent,
  RecoveryOutcome,
  RecoveryTimelineEntry,
} from '@/lib/types';
import {
  Siren,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Search,
  Handshake,
  DollarSign,
  CalendarClock,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Real step names from services/recovery_agent/main.py's STEP_NAMES, plus the
// two extra names it appends outside the normal 1-7 sequence.
const STEP_META: Record<string, { label: string; icon: any }> = {
  find_replacement: { label: 'Find replacement', icon: Search },
  negotiate_replacement: { label: 'Negotiate replacement', icon: Handshake },
  recalculate_cost: { label: 'Recalculate cost', icon: DollarSign },
  check_schedule: { label: 'Check schedule', icon: CalendarClock },
  update_records: { label: 'Update records', icon: ShieldCheck },
  present_diff: { label: 'Present diff', icon: ArrowRight },
  approval_gate: { label: 'Approval gate', icon: ShieldAlert },
  resolve: { label: 'Resolved', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
};

const EVENT_STATUS_THEME: Record<string, { text: string; bg: string; border: string }> = {
  pending: { text: 'text-ink-text-secondary', bg: 'bg-ink-surface/60', border: 'border-ink-border' },
  in_progress: { text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/30' },
  awaiting_approval: { text: 'text-amberx', bg: 'bg-amberx/10', border: 'border-amberx/30' },
  resolved: { text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/30' },
  failed: { text: 'text-redx', bg: 'bg-redx/10', border: 'border-redx/30' },
};

/** `kind` is only ever populated from the audit payload; fall back to the
 * `recovery:`-prefixed reason string the backend always writes for a recovery
 * gate. See ProductionApproval.kind / .reason in lib/types.ts. */
function isRecoveryApproval(a: ProductionApproval): boolean {
  if (a.kind) return a.kind === 'recovery';
  return a.reason?.startsWith('recovery:') ?? false;
}

function asObj(v: unknown): JsonObject | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null;
}

function formatSigned(value: unknown): string {
  const n = parseMoney(typeof value === 'string' || typeof value === 'number' ? value : null);
  if (n === null) return String(value);
  const sign = n > 0 ? '+' : '';
  return sign + formatINR(n);
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    if (/price|total|delta|amount/i.test(key) && /^-?\d+(\.\d+)?$/.test(value)) {
      return formatSigned(value);
    }
    return value || '—';
  }
  if (typeof value === 'number') {
    return /price|total|delta|amount/i.test(key) ? formatSigned(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  }
  return JSON.stringify(value);
}

function outcomeMessage(outcome: RecoveryOutcome): string {
  switch (outcome) {
    case 'resolved':
      return 'Recovery resolved — the replacement booking is confirmed.';
    case 'awaiting_approval':
      return 'The recovery ran and is now waiting on the producer approval below.';
    case 'failed':
      return 'The recovery failed. See the timeline below for the reason.';
    case 'already_in_progress':
      return 'A recovery is already in progress for this production.';
    default:
      return 'Recovery triggered.';
  }
}

function DetailFields({ detail }: { detail: JsonObject }) {
  const entries = Object.entries(detail || {});
  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
      {entries.map(([key, value]) => {
        const nested = asObj(value);
        if (nested) {
          return (
            <div key={key} className="p-2.5 rounded-lg bg-ink-surface/70 border border-ink-border sm:col-span-2">
              <span className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary block mb-1">
                {key.replace(/_/g, ' ')}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {Object.entries(nested).map(([k, v]) => (
                  <div key={k} className="text-[11.5px]">
                    <span className="text-ink-text-tertiary">{k.replace(/_/g, ' ')}: </span>
                    <span className="text-ink-text-primary font-medium">{formatDetailValue(k, v)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={key} className="p-2.5 rounded-lg bg-ink-surface/70 border border-ink-border">
            <span className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary block mb-0.5">
              {key.replace(/_/g, ' ')}
            </span>
            <span className="text-[12px] text-ink-text-primary font-medium">{formatDetailValue(key, value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RecoveryPageContent() {
  const { productionId, status, detail, pendingApprovalId, refreshStatus, refreshDetail, isLoading } =
    useMission();

  const [triggering, setTriggering] = useState(false);
  const [triggerNote, setTriggerNote] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const events: ProductionRecoveryEvent[] = detail?.recovery_events ?? [];
  const latestEvent =
    [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const timeline: RecoveryTimelineEntry[] = latestEvent?.timeline ?? [];

  const affectedBooking = latestEvent?.affected_booking_id
    ? detail?.bookings.find((b) => b.booking_id === latestEvent.affected_booking_id) ?? null
    : null;

  const diffEntry = timeline.find((e) => e.name === 'present_diff') ?? null;
  const diffDetail = diffEntry ? asObj(diffEntry.detail) : null;
  const oldSide = diffDetail ? asObj(diffDetail.old) : null;
  const newSide = diffDetail ? asObj(diffDetail.new) : null;
  const scheduleCollisions =
    diffDetail && Array.isArray(diffDetail.schedule_collisions)
      ? (diffDetail.schedule_collisions as unknown[])
      : [];

  const approvals = detail?.approvals ?? [];
  const recoveryApprovals = approvals.filter(isRecoveryApproval);
  const approval: ProductionApproval | null =
    recoveryApprovals.find((a) => a.approval_id === pendingApprovalId) ??
    [...recoveryApprovals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null;

  const recoveryOptionsUnavailable = detail?.unavailable?.recovery_options ?? null;

  const handleTrigger = async () => {
    if (!productionId) return;
    setTriggering(true);
    setTriggerNote(null);
    try {
      const res = await apiClient.triggerRecovery(productionId, { trigger: 'vendor_unavailable' });
      setTriggerNote({ kind: 'info', text: outcomeMessage(res.outcome) });
      await Promise.all([refreshStatus(), refreshDetail()]);
    } catch (err) {
      if (isConflictError(err)) {
        setTriggerNote({
          kind: 'error',
          text: 'No confirmed booking to recover yet — the pipeline needs to finish booking a vendor first.',
        });
      } else if (isAgentUnavailableError(err)) {
        setTriggerNote({ kind: 'error', text: 'The recovery agent could not be reached. You can retry.' });
      } else if (isApiError(err)) {
        setTriggerNote({ kind: 'error', text: err.detail || err.message });
      } else {
        setTriggerNote({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not trigger recovery.',
        });
      }
    } finally {
      setTriggering(false);
    }
  };

  const handleApprovalDecided = (_result: ApprovalDecisionResponse) => {
    void refreshDetail();
  };

  if (!productionId) {
    return (
      <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
        <div className="glass rounded-2xl p-10 text-center border-dashed border-ink-border">
          <Siren className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
          <div className="text-[14px] font-medium text-ink-text-secondary">No production selected</div>
          <p className="text-[12px] text-ink-text-tertiary mt-1">
            Start or select a production run before triggering an emergency recovery.
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
            <DemoBadge />
            <span className="mono text-[10px] text-redx font-semibold">· Emergency Recovery</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Siren className="h-6 w-6 text-redx" />
            Emergency Recovery Center
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            When a booked vendor drops out, the recovery agent re-sources a replacement, negotiates it,
            recalculates cost, and waits for producer approval if the delta breaches the threshold.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-2 rounded-xl border border-redx/30 bg-redx/10 px-5 py-2.5 text-[13px] font-semibold text-redx hover:bg-redx/20 transition-all disabled:opacity-50"
          >
            {triggering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Trigger Recovery
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Recovery" />

      {triggerNote && (
        <div
          className={cn(
            'rounded-xl p-4 border flex items-start gap-2.5 text-[12.5px]',
            triggerNote.kind === 'error'
              ? 'border-redx/30 bg-redx/10 text-redx'
              : 'border-amberx/30 bg-amberx/10 text-amberx',
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{triggerNote.text}</span>
        </div>
      )}

      {!latestEvent ? (
        <div className="glass rounded-xl p-8 text-center border-dashed border-ink-border">
          <Siren className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
          <div className="text-[13px] font-medium text-ink-text-secondary">No recovery has run yet</div>
          <p className="text-[11px] text-ink-text-tertiary mt-1">
            {isLoading ? 'Loading production detail…' : 'Trigger a recovery above to see it here.'}
          </p>
        </div>
      ) : (
        <>
          {/* Incident Banner */}
          <div
            className={cn(
              'glass-strong rounded-2xl p-6 border flex flex-col md:flex-row items-start md:items-center justify-between gap-5',
              EVENT_STATUS_THEME[latestEvent.status]?.border || 'border-ink-border',
            )}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-redx/15 text-redx">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full',
                      EVENT_STATUS_THEME[latestEvent.status]?.bg,
                      EVENT_STATUS_THEME[latestEvent.status]?.text,
                    )}
                  >
                    {latestEvent.status.replace(/_/g, ' ')}
                  </span>
                  <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-ink-surface text-ink-text-tertiary border border-ink-border">
                    Trigger: {latestEvent.trigger}
                  </span>
                  <span className="mono text-[11px] text-ink-text-tertiary">
                    Event: <strong className="text-ink-text-secondary font-mono">{latestEvent.recovery_event_id.slice(0, 8)}</strong>
                  </span>
                </div>
                <h2 className="text-[16px] font-bold text-ink-text-primary mt-1">
                  {affectedBooking?.vendor_name
                    ? `Booked vendor unavailable: ${affectedBooking.vendor_name}`
                    : 'Booked vendor unavailable'}
                </h2>
                <p className="text-[12.5px] text-ink-text-secondary mt-0.5 mono" suppressHydrationWarning>
                  Opened {new Date(latestEvent.created_at).toLocaleString('en-IN', { hour12: false })}
                  {events.length > 1 && ` · ${events.length} recovery events on this production`}
                </p>
              </div>
            </div>
          </div>

          {/* What the recovery agent chose */}
          <div className="glass-strong rounded-2xl p-6 border border-amberx/30 space-y-4">
            <div className="flex items-center gap-2 text-amberx font-semibold text-[14px]">
              <ArrowRight className="h-4.5 w-4.5" />
              What the recovery agent chose
            </div>

            {oldSide && newSide ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-redx/5 border border-redx/25 p-4">
                  <div className="mono text-[9.5px] uppercase tracking-wider text-redx mb-1">Superseded</div>
                  <div className="text-[14px] font-bold text-ink-text-primary">
                    {typeof oldSide.vendor_name === 'string' ? oldSide.vendor_name : '—'}
                  </div>
                  <div className="mono text-[13px] text-ink-text-secondary mt-1">
                    {formatDetailValue('price', oldSide.price)}
                  </div>
                </div>
                <div className="rounded-xl bg-greenx/5 border border-greenx/25 p-4">
                  <div className="mono text-[9.5px] uppercase tracking-wider text-greenx mb-1">Replacement</div>
                  <div className="text-[14px] font-bold text-ink-text-primary">
                    {typeof newSide.vendor_name === 'string' ? newSide.vendor_name : '—'}
                  </div>
                  <div className="mono text-[13px] text-ink-text-secondary mt-1">
                    {formatDetailValue('price', newSide.price)}
                  </div>
                </div>
                <div className="md:col-span-2 flex items-center justify-between rounded-xl bg-ink-surface/70 border border-ink-border p-3">
                  <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">
                    Cost delta vs. original
                  </span>
                  <span className="mono text-[15px] font-bold text-amberx">
                    {formatDetailValue('delta', diffDetail?.delta)}
                  </span>
                </div>
                {scheduleCollisions.length > 0 && (
                  <div className="md:col-span-2 rounded-lg bg-redx/10 border border-redx/25 p-2.5 text-[11.5px] text-redx">
                    Schedule collisions: {formatDetailValue('schedule_collisions', scheduleCollisions)}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-text-secondary">
                The recovery agent has not produced a replacement diff yet
                {latestEvent.status === 'failed' ? ' — this recovery failed before reaching that step.' : '.'}{' '}
                See the step-by-step timeline below for progress.
              </p>
            )}

            {recoveryOptionsUnavailable && (
              <p className="text-[11px] text-ink-text-tertiary border-t border-ink-border/50 pt-3">
                {recoveryOptionsUnavailable}
              </p>
            )}
          </div>

          {/* Producer approval, if this recovery breached the threshold */}
          {approval && <ApprovalCard approval={approval} onDecided={handleApprovalDecided} />}

          {/* 7-step timeline */}
          <div className="space-y-4">
            <h3 className="text-[16px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Clock className="h-4.5 w-4.5 text-amberx" />
              Recovery Timeline ({timeline.length} of 7 steps)
            </h3>

            <div className="space-y-3">
              {timeline.map((entry, i) => {
                const meta = STEP_META[entry.name] || { label: entry.name, icon: Clock };
                const Icon = meta.icon;
                return (
                  <div
                    key={`${entry.step}-${entry.name}-${i}`}
                    className="glass rounded-xl p-4.5 border border-ink-border"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amberx/10 text-amberx">
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-ink-text-primary">
                            Step {entry.step} · {meta.label}
                          </div>
                          <div className="mono text-[10px] text-ink-text-tertiary" suppressHydrationWarning>
                            {new Date(entry.ts).toLocaleString('en-IN', { hour12: false })}
                          </div>
                        </div>
                      </div>
                    </div>
                    <DetailFields detail={entry.detail} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function RecoveryPage() {
  return (
    <AppShell>
      <RecoveryPageContent />
    </AppShell>
  );
}
