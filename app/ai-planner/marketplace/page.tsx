'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import type { ProductionRequirement, VendorOffer } from '@/lib/types';
import {
  Search,
  Star,
  ShieldCheck,
  ShieldAlert,
  Handshake,
  Filter,
  ArrowRight,
  RotateCw,
  Trophy,
  HelpCircle,
  Radar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { hour12: false });
  } catch {
    return iso;
  }
}

const STATUS_THEME: Record<string, { text: string; bg: string; border: string }> = {
  pending: { text: 'text-ink-text-secondary', bg: 'bg-ink-surface', border: 'border-ink-border' },
  negotiated: { text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/30' },
  accepted: { text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/30' },
  rejected: { text: 'text-redx', bg: 'bg-redx/10', border: 'border-redx/30' },
};

function statusTheme(status: string) {
  return STATUS_THEME[status] ?? STATUS_THEME.pending;
}

function OfferCard({ offer }: { offer: VendorOffer }) {
  const theme = statusTheme(offer.status);
  const termsEntries = Object.entries(offer.terms || {});
  const priceChanged = offer.quoted_price != null && offer.quoted_price !== offer.price;

  return (
    <div
      className={cn(
        'glass card-hover rounded-2xl p-5 border transition-all flex flex-col justify-between space-y-4',
        offer.is_winner ? 'border-amberx/40 glow-amber' : offer.available === false ? 'border-redx/30 opacity-70 bg-redx/5' : 'border-ink-border',
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono text-[10px] uppercase px-2 py-0.5 rounded-full bg-ink-surface text-ink-text-tertiary border border-ink-border">
                Rank {offer.rank != null ? `#${offer.rank}` : 'unranked'}
              </span>
              {offer.is_winner && (
                <span className="mono inline-flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amberx text-ink-bg">
                  <Trophy className="h-3 w-3" /> Winner
                </span>
              )}
              <span
                className={cn(
                  'mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full',
                  theme.bg,
                  theme.text,
                )}
              >
                {offer.status}
              </span>
            </div>
            <h3 className="text-[15px] font-bold text-ink-text-primary mt-1.5 leading-snug">
              {offer.vendor_name ?? 'Unnamed vendor'}
            </h3>
            <div className="text-[11.5px] text-ink-text-secondary mt-0.5">
              {offer.vendor_category ?? '—'} · {offer.vendor_id.slice(0, 8)}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="mono text-[20px] font-bold text-ink-text-primary">{formatINR(offer.price)}</div>
            {priceChanged && (
              <div className="mono text-[10.5px] text-ink-text-tertiary line-through decoration-ink-border">
                {formatINR(offer.quoted_price)} quoted
              </div>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-4 text-[11.5px] text-ink-text-secondary">
          <span className="flex items-center gap-1">
            {offer.available === true ? (
              <span className="text-greenx flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> Available
              </span>
            ) : offer.available === false ? (
              <span className="text-redx flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Unavailable
              </span>
            ) : (
              <span className="text-ink-text-tertiary flex items-center gap-1">
                <HelpCircle className="h-3.5 w-3.5" /> Availability unknown
              </span>
            )}
          </span>
          {offer.vendor_rating_current != null && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-amberx" />
              {offer.vendor_rating_current} rating (current)
            </span>
          )}
          {offer.rounds_completed > 0 && (
            <span className="flex items-center gap-1">
              <Handshake className="h-3.5 w-3.5 text-ink-text-tertiary" />
              {offer.rounds_completed} negotiation round(s)
            </span>
          )}
        </div>

        {/* Terms — the only free-form explanatory data the scout attaches to an offer.
            There is no separate "reasons"/"rejected_reasons" field in this backend;
            raw terms (which can include a fallback pricing reason) are the honest
            substitute. */}
        {termsEntries.length > 0 && (
          <div className="mt-3 rounded-lg bg-ink-surface/50 p-2.5 border border-ink-border/40 space-y-1">
            <div className="mono text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1">
              Offer Terms
            </div>
            <div className="flex flex-wrap gap-1.5">
              {termsEntries.map(([k, v]) => (
                <span
                  key={k}
                  className="mono text-[9.5px] px-1.5 py-0.5 rounded bg-ink-raised/60 text-ink-text-secondary border border-ink-border/70"
                >
                  {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pt-1 flex items-center justify-between">
        <span className="mono text-[10px] text-ink-text-tertiary" suppressHydrationWarning>
          Quoted {formatTimestamp(offer.created_at)}
        </span>
        <Link
          href="/ai-planner/negotiation"
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-amberx hover:underline"
        >
          Negotiation <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function RequirementSection({ requirement }: { requirement: ProductionRequirement }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="mono text-[10.5px] uppercase px-2.5 py-1 rounded-full bg-ink-surface text-ink-text-secondary border border-ink-border">
            {requirement.category}
          </span>
          <span className="mono text-[11px] text-ink-text-tertiary">
            qty {requirement.quantity} · priority {requirement.priority} · {requirement.requirement_id.slice(0, 8)}
          </span>
        </div>
        <span className="mono text-[10.5px] text-ink-text-tertiary">
          {requirement.offers.length} offer(s)
        </span>
      </div>

      {requirement.discovery_runs.length > 0 && (
        <div className="rounded-xl bg-ink-surface/40 border border-ink-border/60 p-3 space-y-1">
          <div className="mono text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary flex items-center gap-1.5">
            <Radar className="h-3 w-3" /> Scout runs (discover)
          </div>
          {requirement.discovery_runs.map((run, i) => (
            <div key={i} className="text-[11px] text-ink-text-secondary" suppressHydrationWarning>
              Considered {run.considered ?? '—'} vendor(s)
              {run.excluded_vendor_ids.length > 0 && ` · excluded ${run.excluded_vendor_ids.length}`}
              {' · returned '}{run.offers_returned} offer(s) · {formatTimestamp(run.ts)}
            </div>
          ))}
        </div>
      )}

      {requirement.offers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-border p-6 text-center text-[12px] text-ink-text-tertiary">
          No offers returned for this requirement yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {requirement.offers.map((offer) => (
            <OfferCard key={offer.offer_id} offer={offer} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplacePageContent() {
  const { productionId, detail, isLoading, refreshDetail } = useMission();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  useEffect(() => {
    if (productionId) refreshDetail();
  }, [productionId, refreshDetail]);

  const requirements = detail?.requirements ?? [];
  const categories = Array.from(new Set(requirements.map((r) => r.category))).sort();
  const filtered = requirements.filter(
    (r) => selectedCategory === 'ALL' || r.category === selectedCategory,
  );
  const totalOffers = requirements.reduce((sum, r) => sum + r.offers.length, 0);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="mono text-[10px] text-ink-text-tertiary">Steps 3–5: discover / solicit / shortlist (read-only)</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Search className="h-6 w-6 text-bluex" />
            Marketplace Scout Results
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Vendors the scout agent found and quoted, ranked by ordinal rank only. There is no
            captured per-factor score breakdown — see the note on each offer&apos;s rank badge.
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
      <WorkflowStepper currentStep="Scout" />

      {/* Honest note about the score breakdown */}
      <div className="glass rounded-xl p-4 border border-amberx/25 bg-amberx/5 flex items-start gap-3 text-[12px] text-ink-text-secondary">
        <HelpCircle className="h-4 w-4 text-amberx shrink-0 mt-0.5" />
        <span>
          The scout&apos;s composite score (suitability, availability, reliability, price, delivery,
          insurance) is computed only as a sort key and discarded — it is never persisted. Only the
          resulting ordinal <strong className="text-ink-text-primary">rank</strong> survives. No
          per-factor breakdown is shown here because none exists on the backend.
        </span>
      </div>

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
      ) : requirements.length === 0 ? (
        <div className="glass rounded-2xl p-8 border border-dashed border-ink-border text-center">
          <p className="text-[13px] text-ink-text-secondary">
            No requirements yet — this page populates once decompose and the scout run have completed.
          </p>
        </div>
      ) : (
        <>
          {/* Filter Tabs — real categories only */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-border pb-4">
            <Filter className="h-4 w-4 text-ink-text-tertiary mr-1" />
            {['ALL', ...categories].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'rounded-xl px-3.5 py-1.5 text-[11.5px] font-medium transition-all',
                  selectedCategory === cat
                    ? 'bg-bluex text-ink-bg font-semibold shadow-md shadow-bluex/20'
                    : 'glass text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong',
                )}
              >
                {cat} {cat === 'ALL' && `(${totalOffers})`}
              </button>
            ))}
          </div>

          <div className="space-y-10">
            {filtered.map((requirement) => (
              <RequirementSection key={requirement.requirement_id} requirement={requirement} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <AppShell>
      <MarketplacePageContent />
    </AppShell>
  );
}
