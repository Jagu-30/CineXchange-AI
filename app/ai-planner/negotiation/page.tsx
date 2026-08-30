'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { ProductionRequirement } from '@/lib/types';
import {
  Handshake,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  Gauge,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return null;
  const theme =
    decision === 'accept'
      ? { text: 'text-greenx', bg: 'bg-greenx/20', icon: CheckCircle2 }
      : decision === 'reject'
        ? { text: 'text-redx', bg: 'bg-redx/20', icon: XCircle }
        : { text: 'text-bluex', bg: 'bg-bluex/20', icon: Handshake };
  const Icon = theme.icon;
  return (
    <span className={cn('mono inline-flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full', theme.bg, theme.text)}>
      <Icon className="h-3 w-3" />
      {decision}
    </span>
  );
}

function RequirementTranscript({ requirement }: { requirement: ProductionRequirement }) {
  const neg = requirement.negotiation;
  const hasActivity =
    neg.rounds.length > 0 || neg.terminal_events.length > 0 || neg.failures.length > 0;

  if (!hasActivity) return null;

  return (
    <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
      <div className="flex items-center justify-between border-b border-ink-border/50 pb-3 flex-wrap gap-2">
        <h2 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
          <Handshake className="h-4.5 w-4.5 text-amberx" />
          {requirement.category}
        </h2>
        <span className="mono text-[11px] text-ink-text-tertiary">
          {requirement.requirement_id.slice(0, 8)} · {neg.rounds.length} round(s)
        </span>
      </div>

      {/* Run summaries — real captured negotiation-run facts, not policy claims */}
      {neg.runs.map((run, i) => {
        const winner = run.winning_offer_id
          ? requirement.offers.find((o) => o.offer_id === run.winning_offer_id)
          : null;
        return (
          <div key={i} className="rounded-xl bg-ink-surface/50 border border-ink-border/60 p-3.5 text-[12px] text-ink-text-secondary flex flex-wrap gap-x-5 gap-y-1.5">
            <span>Max rounds: <strong className="text-ink-text-primary">{run.max_rounds ?? '—'}</strong></span>
            <span>Market anchor: <strong className="text-ink-text-primary">{run.market_anchor != null ? formatINR(run.market_anchor) : '—'}</strong></span>
            <span>Settled: <strong className="text-ink-text-primary">{run.settled == null ? '—' : run.settled ? 'yes' : 'no'}</strong> ({run.settled_count ?? 0})</span>
            {winner && (
              <span className="flex items-center gap-1 text-amberx font-semibold">
                <Trophy className="h-3.5 w-3.5" /> {winner.vendor_name ?? 'winner'} @ {formatINR(run.final_price)}
              </span>
            )}
          </div>
        );
      })}

      {/* Chat transcript — every round, in order */}
      <div className="space-y-4">
        {neg.rounds.map((rnd, i) => (
          <div key={i} className="space-y-2.5">
            {/* Our negotiation agent's offer to the vendor */}
            <div className="rounded-xl p-4 border bg-amberx/10 border-amberx/25 ml-6 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amberx text-ink-bg">
                    Negotiation Agent · Round {rnd.round}
                  </span>
                </div>
                <span className="mono text-[15px] font-bold text-ink-text-primary">{formatINR(rnd.offered)}</span>
              </div>
              {rnd.rationale && (
                <p className="text-[12.5px] leading-relaxed text-ink-text-primary">{rnd.rationale}</p>
              )}
              {rnd.conceded_terms.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {rnd.conceded_terms.map((t) => (
                    <span key={t} className="mono text-[10px] px-2 py-0.5 rounded bg-ink-surface text-ink-text-secondary border border-ink-border">
                      conceded: {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Vendor's reply */}
            <div className="rounded-xl p-4 border bg-ink-surface/70 border-ink-border mr-6 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-ink-raised text-bluex">
                    {rnd.vendor_name ?? 'Vendor'}
                  </span>
                  <DecisionBadge decision={rnd.decision} />
                </div>
                {rnd.vendor_price != null && (
                  <span className="mono text-[15px] font-bold text-ink-text-primary">{formatINR(rnd.vendor_price)}</span>
                )}
              </div>
              {rnd.vendor_message && (
                <p className="text-[12.5px] leading-relaxed text-ink-text-primary">{rnd.vendor_message}</p>
              )}
              <span className="mono text-[10px] text-ink-text-tertiary" suppressHydrationWarning>
                {formatTimestamp(rnd.ts)}
              </span>
            </div>
          </div>
        ))}

        {/* Terminal events — walk-away / vendor unreachable */}
        {neg.terminal_events.map((ev, i) => (
          <div key={`term-${i}`} className="rounded-xl p-3.5 border border-redx/30 bg-redx/10 flex items-start gap-2.5 text-[12px] text-redx">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                {ev.event === 'negotiation_walk_away' ? 'Agent walked away' : 'Vendor unreachable'}
                {ev.round != null && ` at round ${ev.round}`}
              </div>
              {(ev.rationale || ev.error) && <div className="mt-0.5">{ev.rationale ?? ev.error}</div>}
            </div>
          </div>
        ))}

        {/* Failures — the requirement-level negotiate call itself errored */}
        {neg.failures.map((f, i) => (
          <div key={`fail-${i}`} className="rounded-xl p-3.5 border border-redx/30 bg-redx/10 flex items-start gap-2.5 text-[12px] text-redx">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Negotiation failed</div>
              <div className="mt-0.5">
                {f.error ?? 'Unknown error'} — {f.completed_offers ?? 0} offer(s), {f.completed_rounds ?? 0} round(s) completed first.
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NegotiationPageContent() {
  const { productionId, detail, isLoading, refreshDetail } = useMission();

  useEffect(() => {
    if (productionId) refreshDetail();
  }, [productionId, refreshDetail]);

  const requirements = detail?.requirements ?? [];
  const withNegotiation = requirements.filter(
    (r) => r.negotiation.rounds.length > 0 || r.negotiation.terminal_events.length > 0 || r.negotiation.failures.length > 0,
  );

  const totalRounds = requirements.reduce((s, r) => s + r.negotiation.rounds.length, 0);
  const totalSettled = requirements.reduce(
    (s, r) => s + r.negotiation.runs.reduce((rs, run) => rs + (run.settled_count ?? 0), 0),
    0,
  );

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Step 6: negotiate (read-only)</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Handshake className="h-6 w-6 text-amberx" />
            Negotiation Transcript
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            The real round-by-round exchange between the negotiation agent and each vendor.
            Negotiation runs autonomously — there is nothing to submit or accept here.
          </p>
        </div>

        <button
          onClick={() => refreshDetail()}
          disabled={!productionId || isLoading}
          className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong transition-all disabled:opacity-50"
        >
          <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin-slow')} />
          Refresh
        </button>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Negotiate" />

      {!productionId ? (
        <div className="glass rounded-2xl p-8 border border-dashed border-ink-border text-center">
          <p className="text-[13px] text-ink-text-secondary">
            No production selected. Submit a brief on the{' '}
            <Link href="/ai-planner" className="text-amberx hover:underline">
              planner hub
            </Link>{' '}
            to start a run.
          </p>
        </div>
      ) : withNegotiation.length === 0 ? (
        <div className="glass rounded-2xl p-8 border border-dashed border-ink-border text-center">
          <p className="text-[13px] text-ink-text-secondary">
            No negotiation activity yet. This page populates once step 6 (negotiate) runs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-6">
            {withNegotiation.map((requirement) => (
              <RequirementTranscript key={requirement.requirement_id} requirement={requirement} />
            ))}
          </div>

          {/* Real aggregate stats — replaces the old hardcoded policy panel */}
          <div className="xl:col-span-1 space-y-6">
            <div className="glass rounded-2xl p-6 border border-ink-border space-y-4">
              <h3 className="text-[14px] font-semibold text-ink-text-primary flex items-center gap-2">
                <Gauge className="h-4 w-4 text-amberx" />
                Negotiation Activity
              </h3>
              <div className="space-y-2.5 text-[12px]">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                  <span className="text-ink-text-secondary">Requirements negotiated</span>
                  <span className="mono font-semibold text-ink-text-primary">{withNegotiation.length} / {requirements.length}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                  <span className="text-ink-text-secondary">Total rounds</span>
                  <span className="mono font-semibold text-ink-text-primary">{totalRounds}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                  <span className="text-ink-text-secondary">Settled offers</span>
                  <span className="mono font-semibold text-ink-text-primary">{totalSettled}</span>
                </div>
              </div>
              <p className="text-[11px] text-ink-text-tertiary leading-relaxed">
                There is no exposed negotiation policy configuration (target savings %, insurance
                rules, etc.) to display here — those are server-side settings, not part of this
                production&apos;s read model. These numbers are computed from the real rounds above.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NegotiationPage() {
  return (
    <AppShell>
      <NegotiationPageContent />
    </AppShell>
  );
}
