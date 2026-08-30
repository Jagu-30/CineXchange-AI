'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMission } from '@/lib/mission-context';
import { apiClient, isApiError, isConflictError, isAgentUnavailableError } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import { ApprovalCard } from '@/components/shared/approval-card';
import { isRecoveryApproval } from '@/lib/types';
import type { TraceEntry } from '@/lib/types';
import { Siren, Play, RefreshCw, Activity, AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// This used to replay a hardcoded RECOVERY_SCRIPT with setTimeout and
// unconditionally push a canned approval — a scripted playback that looked
// like a real run but was not one. It now drives the actual recovery endpoint
// (POST /productions/{id}/recovery) against whichever production is selected,
// and renders the real trace and the real approval gate if one opens.

function DemoContent() {
  const {
    productionId,
    detail,
    pendingApprovalId,
    steps,
    refreshDetail,
    triggerRecovery,
    error,
    clearError,
  } = useMission();

  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const loadTrace = useCallback(async () => {
    if (!productionId) return;
    setTraceLoading(true);
    setTraceError(null);
    try {
      const res = await apiClient.getTrace(productionId);
      setTrace(res.trace);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : 'Could not load the agent trace.');
    } finally {
      setTraceLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    loadTrace();
  }, [loadTrace]);

  // The provider only opens the stream and takes a `/status` snapshot, so
  // without this `detail` is null on arrival and the approval lookup below can
  // never find anything until the user triggers a recovery from this page.
  useEffect(() => {
    if (productionId) void refreshDetail();
  }, [productionId, refreshDetail]);

  // `kind` is written only from the post-decision audit row, so it is null for
  // the whole time an approval is pending — the only time this card matters.
  // `isRecoveryApproval` falls back to the `recovery:` reason prefix, which is
  // how the orchestrator itself classifies the gate.
  const recoveryApproval =
    pendingApprovalId != null
      ? detail?.approvals.find((a) => a.approval_id === pendingApprovalId && isRecoveryApproval(a)) ??
        null
      : null;

  const handleTrigger = async () => {
    if (!productionId) return;
    setTriggering(true);
    clearError();
    setLastOutcome(null);
    const res = await triggerRecovery({ trigger: 'demo_manual_recovery' });
    if (res) {
      setLastOutcome(res.outcome);
      await Promise.all([refreshDetail(), loadTrace()]);
    }
    setTriggering(false);
  };

  const triggerErrorMessage = error
    ? isConflictError(error)
      ? 'No confirmed booking is available to recover — this appears once the pipeline reaches "booked".'
      : isAgentUnavailableError(error)
        ? 'The recovery agent could not be reached. You can retry.'
        : isApiError(error)
          ? error.detail || error.message
          : error.message
    : null;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1300px] mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Siren className="h-4 w-4 text-redx" />
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-redx font-medium">
            Live Recovery
          </span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary">
          Emergency Recovery
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-text-secondary max-w-2xl">
          Triggers the real recovery endpoint against the selected production&apos;s most expensive confirmed
          booking, and shows the real seven-step recovery timeline as the backend reports it.
        </p>
      </header>

      {!productionId ? (
        <div className="glass rounded-2xl border-dashed border-ink-border p-10 text-center">
          <HelpCircle className="h-8 w-8 text-ink-text-tertiary mx-auto mb-3 opacity-60" />
          <p className="text-[13px] text-ink-text-secondary">No production selected yet.</p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amberx px-4 py-2 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 transition-all"
          >
            Start a production
          </Link>
        </div>
      ) : (
        <>
          {/* Control panel */}
          <div className="mb-8 glass-strong rounded-2xl border-redx/30 glow-alert p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
              <div className="flex items-start gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-redx/15">
                  <AlertTriangle className="h-6 w-6 text-redx" />
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-ink-text-primary">
                    Trigger recovery for this production
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-text-secondary">
                    Calls POST /productions/{'{id}'}/recovery. The backend picks the booking to recover.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => loadTrace()}
                  disabled={traceLoading}
                  className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface/60 px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary transition-all hover:border-ink-border-strong hover:text-ink-text-primary disabled:opacity-40"
                >
                  <RefreshCw className={cn('h-4 w-4', traceLoading && 'animate-spin')} />
                  Refresh trace
                </button>
                <button
                  onClick={handleTrigger}
                  disabled={triggering}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-300',
                    triggering
                      ? 'bg-ink-surface text-ink-text-tertiary cursor-not-allowed'
                      : 'bg-redx text-ink-bg hover:bg-redx/90 hover:shadow-xl hover:shadow-redx/25 hover:-translate-y-0.5',
                  )}
                >
                  {triggering ? (
                    <>
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-text-tertiary border-t-transparent animate-spin-slow" />
                      Triggering…
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Trigger recovery
                    </>
                  )}
                </button>
              </div>
            </div>

            {triggerErrorMessage && (
              <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-redx/30 bg-redx/10 p-3 text-[12px] text-redx">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{triggerErrorMessage}</span>
              </div>
            )}

            {lastOutcome && !triggerErrorMessage && (
              <div className="mt-5 flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-greenx/15">
                  <span className="h-1.5 w-1.5 rounded-full bg-greenx" />
                </div>
                <span className="mono text-[11px] text-greenx font-medium">
                  RECOVERY OUTCOME — {lastOutcome.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-1">
              <div className="mb-4 flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-amberx" />
                <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">Producer Action</h2>
                <div className="flex-1 h-px bg-ink-border" />
              </div>
              {recoveryApproval ? (
                <ApprovalCard approval={recoveryApproval} />
              ) : (
                <div className="glass rounded-xl border-dashed border-ink-border p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-raised">
                    <Siren className="h-7 w-7 text-ink-text-tertiary" />
                  </div>
                  <p className="mt-3 text-[12px] text-ink-text-tertiary leading-relaxed max-w-[240px] mx-auto">
                    {triggering
                      ? 'Waiting for the recovery call to return…'
                      : 'No recovery approval pending. Trigger a recovery to see one appear here if the cost delta needs sign-off.'}
                  </p>
                </div>
              )}
            </div>

            <div className="xl:col-span-2">
              <div className="mb-4 flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-ink-text-tertiary" />
                <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">Agent Trace</h2>
                <div className="flex-1 h-px bg-ink-border" />
              </div>
              {traceError && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-redx/30 bg-redx/10 p-3.5 text-[12.5px] text-redx">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{traceError}</span>
                </div>
              )}
              <div className="xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto pr-1">
                <AgentActivityTimeline entries={trace} steps={steps} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DemoPage() {
  return (
    <AppShell>
      <DemoContent />
    </AppShell>
  );
}
