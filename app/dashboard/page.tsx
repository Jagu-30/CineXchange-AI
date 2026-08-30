'use client';

// Mission control. Previously made zero API calls — every number here (budget,
// committed, savings, agents, requirements, the approval card) was rendered
// from local mock state and a fake approval resolved only in that state.
//
// This now wires to the real autonomous backend: one production, watched over
// SSE + the aggregate GET /productions/{id}, with a real approval gate backed
// by POST /approvals/{id}/decide. Nothing on this page is invented — a figure
// that cannot be computed from `ProductionDetail` renders as an empty state
// instead of a guess.

import { useEffect, useMemo, useState } from 'react';
import { useMission, formatINR, parseMoney } from '@/lib/mission-context';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/shared/app-shell';
import { ApprovalCard } from '@/components/shared/approval-card';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import { IntegrationStatus } from '@/components/shared/integration-status';
import type { ProductionBooking, ProductionRequirement, TraceEntry, VendorOffer } from '@/lib/types';
import {
  Wallet,
  TrendingDown,
  PiggyBank,
  Activity,
  ClipboardList,
  ShieldCheck,
  Radio,
  AlertTriangle,
  Loader2,
  FolderOpen,
  ArrowRight,
  X,
} from 'lucide-react';

function findOfferByBooking(requirements: ProductionRequirement[], booking: ProductionBooking): VendorOffer | null {
  for (const req of requirements) {
    const offer = req.offers.find((o) => o.offer_id === booking.offer_id);
    if (offer) return offer;
  }
  return null;
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

interface RequirementRow {
  requirement: ProductionRequirement;
  vendor: string | null;
  price: number | null;
  quoted: number | null;
  statusLabel: 'Booked' | 'Negotiating' | 'Sourcing' | 'Pending';
}

function buildRequirementRow(req: ProductionRequirement, bookings: ProductionBooking[]): RequirementRow {
  const booking = bookings.find((b) => b.requirement_id === req.requirement_id && b.status === 'confirmed');
  if (booking) {
    const offer = req.offers.find((o) => o.offer_id === booking.offer_id) ?? null;
    return {
      requirement: req,
      vendor: booking.vendor_name,
      price: parseMoney(booking.final_price),
      quoted: offer ? parseMoney(offer.quoted_price) : null,
      statusLabel: 'Booked',
    };
  }
  const winner = req.offers.find((o) => o.is_winner) ?? req.offers[0] ?? null;
  if (winner) {
    return {
      requirement: req,
      vendor: winner.vendor_name,
      price: parseMoney(winner.price),
      quoted: parseMoney(winner.quoted_price),
      statusLabel: req.negotiation.rounds.length > 0 ? 'Negotiating' : 'Sourcing',
    };
  }
  return { requirement: req, vendor: null, price: null, quoted: null, statusLabel: 'Pending' };
}

const STATUS_STYLE: Record<RequirementRow['statusLabel'], string> = {
  Booked: 'text-greenx bg-greenx/10',
  Negotiating: 'text-amberx bg-amberx/10',
  Sourcing: 'text-bluex bg-bluex/10',
  Pending: 'text-ink-text-tertiary bg-ink-text-tertiary/10',
};

function DashboardContent() {
  const {
    productionId,
    selectProduction,
    status,
    detail,
    productions,
    isLoading,
    error,
    clearError,
    refreshDetail,
    refreshProductions,
  } = useMission();

  const [trace, setTrace] = useState<TraceEntry[]>([]);

  useEffect(() => {
    void refreshProductions();
    // Only on mount — refreshProductions is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (productionId) void refreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId]);

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
        if (!cancelled) setTrace([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productionId]);

  const budgetCap = parseMoney(detail?.production.budget_cap ?? status?.budget_cap ?? null);

  const confirmedBookings = useMemo(
    () => (detail?.bookings ?? []).filter((b) => b.status === 'confirmed'),
    [detail],
  );

  const committed = useMemo(
    () => confirmedBookings.reduce((sum, b) => sum + (parseMoney(b.final_price) ?? 0), 0),
    [confirmedBookings],
  );

  const remaining = budgetCap != null ? budgetCap - committed : null;

  const savings = useMemo(() => {
    if (!detail) return { total: 0, count: 0 };
    let total = 0;
    let count = 0;
    for (const b of confirmedBookings) {
      const offer = findOfferByBooking(detail.requirements, b);
      const quoted = parseMoney(offer?.quoted_price ?? null);
      const final = parseMoney(b.final_price);
      if (quoted != null && final != null) {
        total += quoted - final;
        count += 1;
      }
    }
    return { total, count };
  }, [detail, confirmedBookings]);

  const pendingApproval = useMemo(() => {
    if (!detail || !status?.pending_approval_id) return null;
    return detail.approvals.find((a) => a.approval_id === status.pending_approval_id) ?? null;
  }, [detail, status]);

  const requirementRows = useMemo(
    () => (detail ? detail.requirements.map((r) => buildRequirementRow(r, detail.bookings)) : []),
    [detail],
  );

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto">
      {/* Header */}
      <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="h-4 w-4 text-amberx animate-pulse-dot" />
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-amberx font-medium">
              Live · Mission Control
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary">
            {detail?.production.brief_text
              ? detail.production.brief_text.length > 90
                ? `${detail.production.brief_text.slice(0, 90)}...`
                : detail.production.brief_text
              : 'No production selected'}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-text-secondary">
            {detail
              ? `${detail.production.location} · ${detail.production.start_date} → ${detail.production.end_date} · status: ${detail.production.status}`
              : 'Select or launch a production to see live mission data.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/ai-planner"
            className="flex items-center gap-2 rounded-xl bg-amberx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all"
          >
            Launch AI Production Planner →
          </a>
        </div>
      </header>

      {error && (
        <div className="mb-6 glass rounded-xl p-4 border-redx/30 bg-redx/10 flex items-center justify-between gap-3 text-[13px] text-redx">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error.message}</span>
          </div>
          <button onClick={clearError} className="shrink-0 hover:text-redx/70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* No production selected: honest picker, no invented data */}
      {!productionId && (
        <div className="glass rounded-2xl p-8 border-dashed border-ink-border text-center">
          <FolderOpen className="h-8 w-8 text-ink-text-tertiary mx-auto mb-3 opacity-60" />
          <h2 className="text-[15px] font-semibold text-ink-text-primary">No active production</h2>
          <p className="mt-1 text-[12.5px] text-ink-text-secondary max-w-md mx-auto">
            {isLoading
              ? 'Loading your productions…'
              : productions.length > 0
                ? 'Pick a production below, or launch a new one.'
                : "You haven't created a production yet. Launch the AI Production Planner to submit a brief."}
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
                    <span className="mono text-[10px] text-ink-text-tertiary">
                      {formatINR(p.budget_cap)}
                    </span>
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

      {/* Production selected but detail still loading */}
      {productionId && !detail && (
        <div className="glass rounded-2xl p-10 border-ink-border text-center">
          <Loader2 className="h-6 w-6 text-amberx mx-auto mb-3 animate-spin" />
          <p className="text-[12.5px] text-ink-text-secondary">Loading production detail…</p>
        </div>
      )}

      {productionId && detail && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
            <StatCard
              icon={Wallet}
              label="Total Budget"
              value={budgetCap != null ? formatINR(budgetCap) : '—'}
              sub={`${confirmedBookings.length} of ${detail.bookings.length} booking(s) confirmed`}
              accent="amber"
            />
            <StatCard
              icon={PiggyBank}
              label="Committed"
              value={formatINR(committed)}
              sub={remaining != null ? `${formatINR(remaining)} remaining` : 'Budget cap not recorded'}
              accent="blue"
            />
            <StatCard
              icon={TrendingDown}
              label="Negotiation Savings"
              value={savings.count > 0 ? formatINR(savings.total) : '—'}
              sub={
                savings.count > 0
                  ? `across ${savings.count} of ${confirmedBookings.length} booked item(s) with a recorded opening quote`
                  : 'No booked item has a recorded opening quote'
              }
              accent="green"
            />
          </div>

          {/* Agent status row — real MCP reachability, not simulated agent state */}
          <section className="mb-8">
            <SectionTitle icon={Activity} title="Agent Health (MCP Reachability)" />
            <IntegrationStatus pollIntervalMs={20000} />
          </section>

          {/* Main grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-8">
              {pendingApproval && (
                <section>
                  <SectionTitle icon={ShieldCheck} title="Pending Approval" accent="amber" />
                  <ApprovalCard approval={pendingApproval} onDecided={() => void refreshDetail()} />
                </section>
              )}

              <section>
                <SectionTitle icon={Wallet} title="Budget Commitment" />
                <div className="glass rounded-xl p-6">
                  {budgetCap != null ? (
                    <>
                      <div className="mono flex justify-between text-[11px] text-ink-text-tertiary mb-2">
                        <span>Committed {formatINR(committed)}</span>
                        <span>Cap {formatINR(budgetCap)}</span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-ink-raised overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', committed > budgetCap ? 'bg-redx' : 'bg-amberx')}
                          style={{ width: `${Math.min(100, budgetCap > 0 ? (committed / budgetCap) * 100 : 0)}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[11px] text-ink-text-secondary">
                        {remaining != null &&
                          (remaining >= 0
                            ? `${formatINR(remaining)} remaining under cap`
                            : `${formatINR(Math.abs(remaining))} over cap`)}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12px] text-ink-text-tertiary text-center py-6">
                      Budget cap not available for this production.
                    </div>
                  )}
                </div>
              </section>

              <section>
                <SectionTitle icon={ClipboardList} title="Requirements" />
                <div className="glass rounded-xl p-6 overflow-x-auto">
                  {requirementRows.length === 0 ? (
                    <div className="text-[12px] text-ink-text-tertiary text-center py-6">
                      No requirements extracted yet.
                    </div>
                  ) : (
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-ink-border">
                          <th className="mono pb-3 pr-4 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">
                            Category
                          </th>
                          <th className="pb-3 pr-4 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">
                            Vendor
                          </th>
                          <th className="mono pb-3 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">
                            Price
                          </th>
                          <th className="mono pb-3 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">
                            Saved
                          </th>
                          <th className="pb-3 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {requirementRows.map((row) => {
                          const savingsAmount =
                            row.quoted != null && row.price != null ? row.quoted - row.price : null;
                          return (
                            <tr
                              key={row.requirement.requirement_id}
                              className="border-b border-ink-border/40 hover:bg-ink-raised/40 transition-colors"
                            >
                              <td className="py-3.5 pr-4">
                                <span className="mono text-[11px] font-medium text-ink-text-primary">
                                  {requirementLabel(row.requirement)}
                                </span>
                              </td>
                              <td className="py-3.5 pr-4">
                                <span className="text-[12px] text-ink-text-secondary">{row.vendor ?? '—'}</span>
                              </td>
                              <td className="mono py-3.5 pr-4 text-right text-[12px] text-ink-text-primary">
                                {row.price != null ? formatINR(row.price) : '—'}
                              </td>
                              <td className="mono py-3.5 pr-4 text-right text-[11px] text-greenx">
                                {savingsAmount != null && savingsAmount > 0 ? formatINR(savingsAmount) : '—'}
                              </td>
                              <td className="py-3.5">
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold',
                                    STATUS_STYLE[row.statusLabel],
                                  )}
                                >
                                  {row.statusLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>

            <div className="xl:col-span-1">
              <div className="mb-4 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <Activity className="h-4 w-4 text-ink-text-tertiary" />
                  <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">
                    Live Activity Feed
                  </h2>
                </div>
                <a
                  href="/ai-planner/audit"
                  className="mono text-[10px] text-amberx hover:underline inline-flex items-center gap-1"
                >
                  Full audit <ArrowRight className="h-3 w-3" />
                </a>
              </div>
              <div className="xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto pr-1">
                <AgentActivityTimeline entries={trace} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  accent: 'amber' | 'blue' | 'green';
}) {
  const accentMap = {
    amber: { text: 'text-amberx', bg: 'bg-amberx/10', border: 'border-amberx/20' },
    blue: { text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/20' },
    green: { text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/20' },
  };
  const a = accentMap[accent];
  return (
    <div className={`glass card-hover rounded-xl p-6 border ${a.border} hover:border-ink-border-strong`}>
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.bg}`}>
          <Icon className={`h-4.5 w-4.5 ${a.text}`} />
        </div>
      </div>
      <div className="mono mt-4 text-[24px] font-bold text-ink-text-primary">{value}</div>
      <div className="mono mt-1 text-[11px] text-ink-text-secondary">{sub}</div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  accent = 'default',
}: {
  icon: typeof Activity;
  title: string;
  accent?: 'default' | 'amber';
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <Icon className={`h-4 w-4 ${accent === 'amber' ? 'text-amberx' : 'text-ink-text-tertiary'}`} />
      <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">{title}</h2>
      <div className="flex-1 h-px bg-ink-border" />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}
