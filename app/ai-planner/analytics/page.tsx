'use client';

// There is no analytics endpoint. ClickHouse exists only as a write-through
// sink in the backend — nothing ever reads it back over HTTP, so
// `apiClient.getAnalytics` never existed on this client and there is no
// `AnalyticsData` type. The previous version of this page called a method
// that doesn't exist and rendered hardcoded 8.2 / 2.4 / 100 / 98.4 figures
// and a fake three-row price history whenever that call failed — which was
// always, since the endpoint was never built.
//
// What follows is split into two honest halves:
//   1. Figures genuinely derivable from the real aggregate (GET /productions/{id})
//      — per-requirement negotiation savings, computed from the opening offer
//      price vs. the winning offer's final price, plus the real round count.
//   2. An explicit "not available in this build" panel for everything that
//      would require the ClickHouse read surface that was never built.
// Nothing here is invented. A production with no negotiation history renders
// an empty state, not a placeholder number.

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/shared/app-shell';
import { IntegrationStatus } from '@/components/shared/integration-status';
import { useMission, formatINR, parseMoney } from '@/lib/mission-context';
import type { ProductionRequirement, VendorOffer } from '@/lib/types';
import {
  Database,
  TrendingDown,
  BarChart3,
  Ban,
  FolderOpen,
  Loader2,
  ArrowDown,
} from 'lucide-react';

interface RequirementSavings {
  requirement: ProductionRequirement;
  label: string;
  winner: VendorOffer;
  openingPrice: number;
  finalPrice: number;
  savingsAmount: number;
  savingsPct: number;
  roundCount: number;
}

function requirementLabel(req: ProductionRequirement): string {
  const spec = req.spec as Record<string, unknown>;
  const candidate =
    (typeof spec.name === 'string' && spec.name) ||
    (typeof spec.item === 'string' && spec.item) ||
    (typeof spec.description === 'string' && spec.description) ||
    null;
  return candidate || req.category;
}

/**
 * Real, derived from the aggregate: the winning offer's opening quote vs. its
 * final negotiated price. Skips any requirement without a winner or without
 * a recorded opening quote — those genuinely have nothing to compute from.
 */
function deriveRequirementSavings(requirements: ProductionRequirement[]): RequirementSavings[] {
  const rows: RequirementSavings[] = [];
  for (const req of requirements) {
    const winner = req.offers.find((o) => o.is_winner);
    if (!winner) continue;
    const opening = parseMoney(winner.quoted_price);
    const final = parseMoney(winner.price);
    if (opening == null || final == null || opening <= 0) continue;
    const savingsAmount = opening - final;
    rows.push({
      requirement: req,
      label: requirementLabel(req),
      winner,
      openingPrice: opening,
      finalPrice: final,
      savingsAmount,
      savingsPct: (savingsAmount / opening) * 100,
      roundCount: req.negotiation.rounds.filter((r) => r.offer_id === winner.offer_id).length,
    });
  }
  return rows;
}

function AnalyticsContent() {
  const { productionId, detail, productions, isLoading, refreshDetail, refreshProductions, selectProduction } =
    useMission();

  useEffect(() => {
    void refreshProductions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (productionId) void refreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId]);

  const rows = useMemo(() => (detail ? deriveRequirementSavings(detail.requirements) : []), [detail]);

  const aggregate = useMemo(() => {
    if (rows.length === 0) return null;
    const totalSavings = rows.reduce((s, r) => s + r.savingsAmount, 0);
    const avgPct = rows.reduce((s, r) => s + r.savingsPct, 0) / rows.length;
    const avgRounds = rows.reduce((s, r) => s + r.roundCount, 0) / rows.length;
    return { totalSavings, avgPct, avgRounds, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              DERIVED FROM PRODUCTION DATA
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-ink-text-primary">
              Negotiation Analytics
            </h1>
          </div>
          <p className="text-sm text-ink-text-secondary mt-1">
            Realised savings and round counts computed directly from this production&apos;s offers and
            negotiation history — not from a separate analytics store.
          </p>
        </div>
      </div>

      <IntegrationStatus />

      {!productionId && (
        <div className="glass rounded-2xl p-8 border-dashed border-ink-border text-center">
          <FolderOpen className="h-8 w-8 text-ink-text-tertiary mx-auto mb-3 opacity-60" />
          <h2 className="text-[15px] font-semibold text-ink-text-primary">No active production</h2>
          <p className="mt-1 text-[12.5px] text-ink-text-secondary max-w-md mx-auto">
            {isLoading
              ? 'Loading your productions…'
              : productions.length > 0
                ? 'Pick a production below to see its negotiation analytics.'
                : 'Create a production from the AI Production Planner first.'}
          </p>
          {productions.length > 0 && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
              {productions.map((p) => (
                <button
                  key={p.production_id}
                  onClick={() => selectProduction(p.production_id)}
                  className="glass card-hover rounded-xl p-4 border border-ink-border hover:border-amberx/40 transition-all text-left"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="mono text-[9px] uppercase tracking-wider text-amberx font-semibold">
                      {p.status}
                    </span>
                    <span className="mono text-[10px] text-ink-text-tertiary">{formatINR(p.budget_cap)}</span>
                  </div>
                  <div className="text-[12px] text-ink-text-secondary line-clamp-2">
                    {p.brief_text}
                    {p.brief_truncated && '...'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {productionId && !detail && (
        <div className="glass rounded-2xl p-10 border-ink-border text-center">
          <Loader2 className="h-6 w-6 text-amberx mx-auto mb-3 animate-spin" />
          <p className="text-[12.5px] text-ink-text-secondary">Loading production detail…</p>
        </div>
      )}

      {productionId && detail && (
        <>
          {/* Real, derived section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
              <div className="flex items-center justify-between text-ink-text-secondary text-xs">
                <span>Avg Negotiated Savings</span>
                <TrendingDown className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-2">
                {aggregate ? `${aggregate.avgPct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[11px] text-ink-text-tertiary mt-1">
                {aggregate
                  ? `Across ${aggregate.count} won requirement(s) with a recorded opening quote`
                  : 'No won requirement has a recorded opening quote'}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
              <div className="flex items-center justify-between text-ink-text-secondary text-xs">
                <span>Avg Rounds to Close</span>
                <BarChart3 className="w-4 h-4 text-amberx" />
              </div>
              <div className="text-2xl font-bold font-mono text-amberx mt-2">
                {aggregate ? aggregate.avgRounds.toFixed(1) : '—'}
              </div>
              <div className="text-[11px] text-ink-text-tertiary mt-1">
                Counted from real negotiation rounds on the winning offer
              </div>
            </div>

            <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
              <div className="flex items-center justify-between text-ink-text-secondary text-xs">
                <span>Total Realised Savings</span>
                <Database className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-cyan-400 mt-2">
                {aggregate ? formatINR(aggregate.totalSavings) : '—'}
              </div>
              <div className="text-[11px] text-ink-text-tertiary mt-1">
                Sum of (opening quote − final price) on won offers
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center justify-between border-b border-ink-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-semibold text-ink-text-primary">Per-Requirement Negotiation Savings</h2>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                REAL — from this production
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="text-center py-8 text-ink-text-tertiary text-sm">
                No requirement has both a winning offer and a recorded opening quote yet.
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <div
                    key={row.requirement.requirement_id}
                    className="p-3.5 rounded-xl border border-ink-border bg-ink-surface-raised/50 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink-text-primary truncate">{row.label}</div>
                      <div className="text-[11px] text-ink-text-tertiary">
                        {row.winner.vendor_name ?? 'Unknown vendor'} · {row.roundCount} round(s) ·{' '}
                        {formatINR(row.openingPrice)} → {formatINR(row.finalPrice)}
                      </div>
                    </div>
                    <div className="mono inline-flex items-center gap-1 text-sm font-bold text-greenx shrink-0">
                      <ArrowDown className="w-3.5 h-3.5" />
                      {formatINR(row.savingsAmount)} ({row.savingsPct.toFixed(1)}%)
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Honest unavailable section */}
          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center gap-2 border-b border-ink-border pb-3 mb-4">
              <Ban className="w-5 h-5 text-ink-text-tertiary" />
              <h2 className="text-base font-semibold text-ink-text-primary">Not Available In This Build</h2>
            </div>
            <p className="text-[12.5px] text-ink-text-secondary leading-relaxed">
              ClickHouse is a write-through sink in this backend — production events are written to it, but
              there is no HTTP read endpoint exposed to query it back. There is no <code>/analytics</code>{' '}
              route, no historical price-history table, and no cross-production trend data. The metrics below
              cannot be shown honestly and are intentionally omitted rather than faked:
            </p>
            <ul className="mt-3 space-y-1.5 text-[12px] text-ink-text-tertiary">
              <li>• Historical price history across past productions (would require a ClickHouse query endpoint)</li>
              <li>• Vendor reliability / on-time delivery / equipment uptime benchmarks (never captured anywhere)</li>
              <li>• Cross-production trend lines and time-series aggregates</li>
              <li>• Vendor compliance rate as a rolling metric (only per-production compliance checks exist)</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell>
      <AnalyticsContent />
    </AppShell>
  );
}
