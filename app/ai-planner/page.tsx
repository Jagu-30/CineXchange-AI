'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMission, formatINR } from '@/lib/mission-context';
import type { StreamState } from '@/lib/mission-context';
import { apiClient } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import { ApprovalCard } from '@/components/shared/approval-card';
import { IntegrationStatus } from '@/components/shared/integration-status';
import {
  PIPELINE_STEP_NAMES,
  type PipelineStepName,
  type StepStatus,
  type JsonObject,
  type TraceEntry,
  type RecoveryResponse,
} from '@/lib/types';
import {
  Sparkles,
  Brain,
  Search,
  Send,
  ListChecks,
  Handshake,
  Calculator,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  Upload,
  Siren,
  RotateCw,
  AlertTriangle,
  Wallet,
  Clock,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// A minimal structural shape both StepStreamEvent (from the SSE stream) and
// StatusStep (from the /status snapshot) satisfy, so the row renderer below
// does not care which source produced a given step.
interface StepLike {
  step: number;
  name: PipelineStepName;
  status: StepStatus;
  detail: JsonObject;
  ts: string;
}

const STEP_ICON: Record<PipelineStepName, any> = {
  ingest: Upload,
  decompose: Brain,
  discover: Search,
  solicit: Send,
  shortlist: ListChecks,
  negotiate: Handshake,
  total: Calculator,
  compliance: ShieldCheck,
  approval_gate: UserCheck,
  book: CheckCircle2,
};

const STEP_LABEL: Record<PipelineStepName, string> = {
  ingest: 'Ingest Brief',
  decompose: 'Decompose Requirements',
  discover: 'Discover Vendors',
  solicit: 'Solicit Offers',
  shortlist: 'Shortlist Candidates',
  negotiate: 'Negotiate Terms',
  total: 'Total Cost',
  compliance: 'Compliance Check',
  approval_gate: 'Approval Gate',
  book: 'Book Vendors',
};

const STEP_LINK: Partial<Record<PipelineStepName, string>> = {
  decompose: '/ai-planner/requirements',
  discover: '/ai-planner/marketplace',
  solicit: '/ai-planner/marketplace',
  shortlist: '/ai-planner/marketplace',
  negotiate: '/ai-planner/negotiation',
};

type RowStatus = StepStatus | 'not_started';

const STEP_STATUS_THEME: Record<RowStatus, { label: string; text: string; bg: string; border: string }> = {
  not_started: { label: 'Not started', text: 'text-ink-text-tertiary', bg: 'bg-ink-surface/40', border: 'border-ink-border' },
  in_progress: { label: 'In progress', text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/30' },
  done: { label: 'Done', text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/30' },
  failed: { label: 'Failed', text: 'text-redx', bg: 'bg-redx/10', border: 'border-redx/30' },
  terminal: { label: 'Terminal', text: 'text-ink-text-secondary', bg: 'bg-ink-surface/60', border: 'border-ink-border' },
};

const STREAM_LABEL: Record<StreamState, string> = {
  idle: 'No stream',
  connecting: 'Connecting…',
  open: 'Live',
  ended: 'Stream ended',
  error: 'Stream error',
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour12: false });
  } catch {
    return iso;
  }
}

function PlannerHubContent() {
  const {
    productionId,
    selectProduction,
    latestStepByNumber,
    streamState,
    streamError,
    status,
    detail,
    productions,
    pendingApprovalId,
    productionStatus,
    isLoading,
    error,
    clearError,
    createProduction,
    refreshStatus,
    refreshDetail,
    refreshProductions,
    triggerRecovery,
  } = useMission();

  // --- brief submission form ------------------------------------------------
  const [briefText, setBriefText] = useState('');
  const [budgetCap, setBudgetCap] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- recovery trigger form -------------------------------------------------
  const [recoveryTrigger, setRecoveryTrigger] = useState('');
  const [recoveryFormError, setRecoveryFormError] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<RecoveryResponse | null>(null);

  // --- trace (agent/orchestrator decisions), fetched separately from the
  // status snapshot the context already tracks --------------------------------
  const [trace, setTrace] = useState<TraceEntry[]>([]);

  useEffect(() => {
    refreshProductions();
  }, [refreshProductions]);

  useEffect(() => {
    if (!productionId) return;
    refreshDetail();
  }, [productionId, pendingApprovalId, refreshDetail]);

  useEffect(() => {
    if (!productionId) {
      setTrace([]);
      return;
    }
    let cancelled = false;
    apiClient
      .getTrace(productionId)
      .then((res) => {
        if (!cancelled) setTrace(res.trace);
      })
      .catch(() => {
        // Best-effort: the activity timeline already renders an honest empty
        // state when entries is [].
      });
    return () => {
      cancelled = true;
    };
  }, [productionId, latestStepByNumber.length]);

  const handleSubmitBrief = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (briefText.trim().length < 10) {
      setFormError('The brief must be at least 10 characters.');
      return;
    }
    if (!budgetCap.trim() || !location.trim() || !startDate || !endDate) {
      setFormError('Budget cap, location, start date, and end date are all required.');
      return;
    }
    setSubmitting(true);
    const result = await createProduction({
      brief_text: briefText.trim(),
      budget_cap: budgetCap.trim(),
      location: location.trim(),
      start_date: startDate,
      end_date: endDate,
    });
    setSubmitting(false);
    if (result) {
      setBriefText('');
      setBudgetCap('');
      setLocation('');
      setStartDate('');
      setEndDate('');
    }
  };

  const handleTriggerRecovery = async (e: FormEvent) => {
    e.preventDefault();
    setRecoveryFormError(null);
    if (!recoveryTrigger.trim()) {
      setRecoveryFormError('Describe what triggered this recovery.');
      return;
    }
    setRecoverySubmitting(true);
    const res = await triggerRecovery({ trigger: recoveryTrigger.trim() });
    setRecoverySubmitting(false);
    if (res) {
      setRecoveryResult(res);
      setRecoveryTrigger('');
      refreshDetail();
    }
  };

  const handleSync = async () => {
    await Promise.all([refreshStatus(), refreshDetail(), refreshProductions()]);
  };

  const stepsSource: StepLike[] = latestStepByNumber.length > 0 ? latestStepByNumber : status?.steps ?? [];
  const pendingApproval = detail?.approvals.find((a) => a.approval_id === pendingApprovalId) ?? null;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            {productionStatus && (
              <span className="mono text-[10px] text-ink-text-tertiary">· Status: {productionStatus}</span>
            )}
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary">
            AI Production Planner
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            One autonomous run: submit a brief and the ten-step agent pipeline runs on its own,
            streaming progress live below. It pauses only once, at the producer approval gate.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {productionId && (
            <span
              className={cn(
                'mono inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border',
                streamState === 'open'
                  ? 'text-greenx border-greenx/30 bg-greenx/10'
                  : streamState === 'error'
                    ? 'text-redx border-redx/30 bg-redx/10'
                    : 'text-ink-text-tertiary border-ink-border bg-ink-surface',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', streamState === 'open' ? 'bg-greenx animate-pulse-dot' : 'bg-ink-text-tertiary')} />
              {STREAM_LABEL[streamState]}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong transition-all"
          >
            <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin-slow')} />
            Sync State
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Intake" />

      {/* Integration Status (real GET /healthz agent reachability) */}
      <IntegrationStatus />

      {error && (
        <div className="glass rounded-xl p-4 border-redx/30 bg-redx/10 flex items-start gap-3 text-[13px] text-redx">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1">{error.message}</div>
          <button onClick={clearError} className="mono text-[10px] uppercase text-redx/80 hover:text-redx shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {streamError && (
        <div className="glass rounded-xl p-4 border-amberx/30 bg-amberx/10 flex items-center gap-3 text-[13px] text-amberx">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>
            {streamError.message}
            {streamError.willRetry ? ' — reconnecting automatically.' : ''}
          </span>
        </div>
      )}

      {/* Overview Stat Grid — real values only */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass card-hover rounded-xl p-5 border border-amberx/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Budget Cap</span>
            <Wallet className="h-4 w-4 text-amberx" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {status ? formatINR(status.budget_cap) : '—'}
          </div>
          <div className="mono text-[11px] text-ink-text-tertiary mt-1">
            {status ? `Total cost: ${formatINR(status.total_cost)}` : 'No production selected'}
          </div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-bluex/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Pipeline Progress</span>
            <Sparkles className="h-4 w-4 text-bluex" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {status ? `${status.current_step} / 10` : '—'}
          </div>
          <div className="text-[11px] text-ink-text-secondary mt-1">Steps completed</div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-greenx/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Requirements</span>
            <Brain className="h-4 w-4 text-greenx" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {detail ? detail.requirements.length : '—'}
          </div>
          <div className="text-[11px] text-greenx mt-1">Extracted by decompose</div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-purple-500/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Bookings</span>
            <CheckCircle2 className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {detail ? detail.bookings.filter((b) => b.status === 'confirmed').length : '—'}
          </div>
          <div className="text-[11px] text-purple-400 mt-1">Confirmed vendors</div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">
          {/* Brief intake — the one control that starts a run */}
          <form onSubmit={handleSubmitBrief} className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amberx/15 text-amberx">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-ink-text-primary">Submit a Production Brief</h2>
                <p className="text-[11.5px] text-ink-text-tertiary">
                  Starts a new autonomous run. All ten agent steps then execute on their own — there is nothing
                  further to click except at the approval gate below.
                </p>
              </div>
            </div>

            <div>
              <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-2">
                Shoot Brief & Constraints
              </label>
              <textarea
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-ink-border bg-ink-surface/70 px-4 py-3 text-[13px] leading-relaxed text-ink-text-primary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
                placeholder="Describe the shoot: scenes, location constraints, equipment needs, dates..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Budget Cap
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={budgetCap}
                  onChange={(e) => setBudgetCap(e.target.value)}
                  placeholder="e.g. 2500000.00"
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[14px] font-semibold text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Shoot Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Western Ghats, Agumbe"
                  className="w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[13px] text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[13px] text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[13px] text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>
            </div>

            {formError && <div className="text-[12px] text-redx">{formError}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amberx to-amber-500 px-6 py-3 text-[13px] font-semibold text-ink-bg hover:opacity-95 hover:shadow-xl hover:shadow-amberx/25 transition-all duration-300 disabled:opacity-50"
            >
              {submitting ? (
                <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Submit Brief & Start Run
            </button>
          </form>

          {/* Live 10-step pipeline */}
          <div className="glass rounded-2xl p-7 border border-ink-border space-y-5">
            <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Clock className="h-4 w-4 text-amberx" />
              Pipeline Steps
            </h3>
            {!productionId ? (
              <p className="text-[12.5px] text-ink-text-secondary">
                No production selected. Submit a brief above, or pick a recent run on the right.
              </p>
            ) : (
              <div className="space-y-2.5">
                {PIPELINE_STEP_NAMES.map((name, idx) => {
                  const stepNumber = idx + 1;
                  const found = stepsSource.find((s) => s.step === stepNumber);
                  const rowStatus: RowStatus = found?.status ?? 'not_started';
                  const theme = STEP_STATUS_THEME[rowStatus];
                  const Icon = STEP_ICON[name];
                  const href = STEP_LINK[name];

                  const row = (
                    <div
                      className={cn(
                        'flex items-center gap-3.5 rounded-xl border p-3.5 transition-all',
                        theme.border,
                        rowStatus !== 'not_started' && theme.bg,
                      )}
                    >
                      <div className="mono text-[11px] text-ink-text-tertiary w-5 shrink-0">{stepNumber}</div>
                      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', theme.bg)}>
                        <Icon className={cn('h-4 w-4', theme.text)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-ink-text-primary">{STEP_LABEL[name]}</div>
                        {found && (
                          <div className="mono text-[10px] text-ink-text-tertiary mt-0.5" suppressHydrationWarning>
                            {formatTimestamp(found.ts)}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'mono shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider',
                          theme.bg,
                          theme.text,
                        )}
                      >
                        {theme.label}
                      </span>
                    </div>
                  );

                  return href ? (
                    <Link key={name} href={href} className="block hover:opacity-90 transition-opacity">
                      {row}
                    </Link>
                  ) : (
                    <div key={name}>{row}</div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Approval gate — appears only when the backend is actually waiting */}
          {pendingApproval && (
            <ApprovalCard approval={pendingApproval} onDecided={() => refreshDetail()} />
          )}

          {/* Recovery trigger — the second and last control on this page */}
          <div className="glass rounded-2xl p-7 border border-redx/25 space-y-4">
            <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Siren className="h-4 w-4 text-redx" />
              Trigger Recovery
            </h3>
            <p className="text-[12px] text-ink-text-secondary">
              Runs the seven-step recovery for the current production&apos;s most expensive confirmed
              booking. Requires a confirmed booking to exist; the backend rejects this otherwise.
            </p>
            <form onSubmit={handleTriggerRecovery} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={recoveryTrigger}
                onChange={(e) => setRecoveryTrigger(e.target.value)}
                placeholder="What happened? e.g. vendor reported equipment failure"
                disabled={!productionId}
                className="flex-1 rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[13px] text-ink-text-primary focus:border-redx/40 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!productionId || recoverySubmitting}
                className="flex items-center justify-center gap-2 rounded-xl bg-redx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-redx/90 transition-all disabled:opacity-50"
              >
                {recoverySubmitting ? (
                  <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                Trigger Recovery
              </button>
            </form>
            {recoveryFormError && <div className="text-[12px] text-redx">{recoveryFormError}</div>}
            {recoveryResult && (
              <div className="rounded-lg bg-ink-surface/60 border border-ink-border p-3 text-[12px] text-ink-text-secondary">
                Outcome: <span className="font-semibold text-ink-text-primary">{recoveryResult.outcome}</span>
                {' · '}
                {recoveryResult.timeline.length} timeline step(s) recorded.
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Live Agent Activity + Recent Productions */}
        <div className="xl:col-span-1 space-y-6">
          <div className="space-y-4">
            <h3 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary flex items-center gap-2">
              <Clock className="h-4 w-4 text-amberx" />
              Live Agent Activity
            </h3>
            <div className="max-h-[calc(100vh-32rem)] min-h-[16rem] overflow-y-auto pr-1">
              <AgentActivityTimeline entries={trace} steps={latestStepByNumber} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary flex items-center gap-2">
              <History className="h-4 w-4 text-amberx" />
              Recent Productions
            </h3>
            {productions.length === 0 ? (
              <div className="glass rounded-xl p-4 border border-dashed border-ink-border text-[11.5px] text-ink-text-tertiary">
                No productions yet.
              </div>
            ) : (
              <div className="space-y-2">
                {productions.map((p) => (
                  <button
                    key={p.production_id}
                    onClick={() => selectProduction(p.production_id)}
                    className={cn(
                      'w-full text-left glass card-hover rounded-xl p-3 border transition-all',
                      p.production_id === productionId ? 'border-amberx/40 glow-amber' : 'border-ink-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-[10px] uppercase text-ink-text-tertiary">{p.status}</span>
                      <span className="mono text-[10px] text-ink-text-tertiary">{formatINR(p.budget_cap)}</span>
                    </div>
                    <p className="text-[11.5px] text-ink-text-primary mt-1 line-clamp-2">
                      {p.brief_text}
                      {p.brief_truncated ? '…' : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AIPlannerPage() {
  return (
    <AppShell>
      <PlannerHubContent />
    </AppShell>
  );
}
