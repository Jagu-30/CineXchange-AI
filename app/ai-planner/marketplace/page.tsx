'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { ScoredCandidate } from '@/lib/types';
import {
  Search,
  Star,
  Clock,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Handshake,
  Filter,
  ArrowRight,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function MarketplacePageContent() {
  const router = useRouter();
  const { productionState, startNegotiation, runScout } = useMission();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [loadingNegotiation, setLoadingNegotiation] = useState<string | null>(null);

  const candidates: ScoredCandidate[] = productionState?.candidates || [];

  const filteredCandidates = candidates.filter((c) => {
    if (selectedCategory === 'ALL') return true;
    return c.candidate.resource_type.toUpperCase() === selectedCategory.toUpperCase();
  });

  const handleStartNegotiate = async (vendorId: string, resourceId: string) => {
    setLoadingNegotiation(`${vendorId}-${resourceId}`);
    await startNegotiation(vendorId, resourceId);
    setLoadingNegotiation(null);
    router.push('/ai-planner/negotiation');
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Scout Agent Sourcing Engine</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Search className="h-6 w-6 text-bluex" />
            Marketplace Scout & Vendor Ranking
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Multi-criteria weighted scoring (Suitability 30%, Availability 20%, Reliability 20%, Price 15%, Delivery 10%, Insurance 5%) with strict deterministic hard filtering.
          </p>
        </div>

        <button
          onClick={() => runScout()}
          className="flex items-center gap-2 rounded-xl bg-bluex px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-bluex/90 shadow-lg shadow-bluex/20 transition-all"
        >
          <Search className="h-4 w-4" />
          Re-Run Marketplace Scout
        </button>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Scout" />

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-border pb-4">
        <Filter className="h-4 w-4 text-ink-text-tertiary mr-1" />
        {['ALL', 'CAMERA', 'LIGHTING', 'GENERATOR', 'DRONE', 'PILOT', 'TRANSPORT', 'INSURANCE', 'PERMIT'].map((cat) => (
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
            {cat}
          </button>
        ))}
      </div>

      {/* Candidates Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(filteredCandidates.length > 0
          ? filteredCandidates
          : [
              {
                candidate: {
                  vendor_id: 'V003',
                  vendor_name: 'ForestFrame Rentals',
                  resource_id: 'CAM-002',
                  resource_name: 'Sony FX9 Low-Light Dual-ISO Cinema Package',
                  resource_type: 'CAMERA',
                  price: 488000,
                  currency: 'INR',
                  available: true,
                  delivery_days: 0,
                  distance_km: 12,
                  reliability_score: 98.0,
                  suitability_score: 97.0,
                  quality_score: 95.0,
                  insurance_included: true,
                  insurance_required: true,
                  location: 'Agumbe Hub (12 km away)',
                  included_services: ['GM Master Primes', 'Rain Rigging', 'On-site Tech Support'],
                  specifications: { low_light: true, native_iso: 4000 },
                },
                hard_constraints_passed: true,
                score: 94.3,
                score_breakdown: {
                  suitability: 29.1,
                  availability: 20.0,
                  reliability: 19.6,
                  price: 13.0,
                  delivery: 10.0,
                  insurance: 5.0,
                },
                reasons: ['Low-light compatible', 'Available for all 3 days', '98% reliability', 'Insurance included'],
                rejected_reasons: [],
              },
              {
                candidate: {
                  vendor_id: 'V001',
                  vendor_name: 'LightForge Rentals',
                  resource_id: 'CAM-001',
                  resource_name: 'ARRI Alexa Mini LF Package + Prime Lenses',
                  resource_type: 'CAMERA',
                  price: 480000,
                  currency: 'INR',
                  available: true,
                  delivery_days: 1,
                  distance_km: 340,
                  reliability_score: 96.0,
                  suitability_score: 98.0,
                  quality_score: 96.0,
                  insurance_included: true,
                  insurance_required: true,
                  location: 'Bengaluru',
                  included_services: ['2x Sigma Primes', 'Power Package', 'Flight Cases'],
                  specifications: { low_light: true },
                },
                hard_constraints_passed: true,
                score: 92.1,
                score_breakdown: {
                  suitability: 29.4,
                  availability: 20.0,
                  reliability: 19.2,
                  price: 13.5,
                  delivery: 8.0,
                  insurance: 5.0,
                },
                reasons: ['Low-light compatible', 'Available', '96% reliability'],
                rejected_reasons: [],
              },
              {
                candidate: {
                  vendor_id: 'V005',
                  vendor_name: 'CheapGear QuickRent',
                  resource_id: 'CAM-003',
                  resource_name: 'Blackmagic Cinema 6K Basic Rig',
                  resource_type: 'CAMERA',
                  price: 320000,
                  currency: 'INR',
                  available: true,
                  delivery_days: 2,
                  distance_km: 210,
                  reliability_score: 70.0,
                  suitability_score: 58.0,
                  quality_score: 72.0,
                  insurance_included: false,
                  insurance_required: true,
                  location: 'Hubballi',
                  included_services: ['Basic battery pack'],
                  specifications: { low_light: false },
                },
                hard_constraints_passed: false,
                score: 41.5,
                score_breakdown: {
                  suitability: 17.4,
                  availability: 20.0,
                  reliability: 14.0,
                  price: 15.0,
                  delivery: 5.0,
                  insurance: 0.0,
                },
                reasons: [],
                rejected_reasons: [
                  'Lacks mandatory low-light dual-ISO sensitivity',
                  'No equipment insurance included',
                  'Quality score 72 < 85 minimum threshold',
                ],
              },
              {
                candidate: {
                  vendor_id: 'V004',
                  vendor_name: 'CineCore Rentals',
                  resource_id: 'CAM-004',
                  resource_name: 'RED V-Raptor 8K VV Cinema Package',
                  resource_type: 'CAMERA',
                  price: 520000,
                  currency: 'INR',
                  available: false,
                  delivery_days: 1,
                  distance_km: 48,
                  reliability_score: 95.0,
                  suitability_score: 94.0,
                  quality_score: 96.0,
                  insurance_included: true,
                  insurance_required: true,
                  location: 'Udupi',
                  included_services: ['Cooke Primes', 'CineCore Master Rig'],
                  specifications: { low_light: true },
                },
                hard_constraints_passed: false,
                score: 45.0,
                score_breakdown: {
                  suitability: 28.2,
                  availability: 0.0,
                  reliability: 19.0,
                  price: 11.0,
                  delivery: 8.0,
                  insurance: 5.0,
                },
                reasons: [],
                rejected_reasons: ['Candidate currently booked on another production set (Unavailable)'],
              },
            ]
        ).map((scored, idx) => {
          const cand = scored.candidate;
          const isTop = idx === 0 && scored.hard_constraints_passed;
          const isRejected = !scored.hard_constraints_passed;

          return (
            <div
              key={`${cand.vendor_id}-${cand.resource_id}`}
              className={cn(
                'glass card-hover rounded-2xl p-6 border transition-all flex flex-col justify-between space-y-5',
                isTop
                  ? 'border-amberx/40 glow-amber'
                  : isRejected
                    ? 'border-redx/30 opacity-70 bg-redx/5'
                    : 'border-ink-border',
              )}
            >
              <div>
                {/* Header & Badges */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="mono text-[10px] uppercase px-2 py-0.5 rounded-full bg-ink-surface text-ink-text-tertiary border border-ink-border">
                        {cand.resource_type} · {cand.vendor_id}
                      </span>
                      {isTop && (
                        <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amberx text-ink-bg">
                          Top Recommendation
                        </span>
                      )}
                      {isRejected && (
                        <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-redx/20 text-redx">
                          Hard Filter Rejected
                        </span>
                      )}
                    </div>
                    <h3 className="text-[16px] font-bold text-ink-text-primary mt-1.5 leading-snug">
                      {cand.resource_name}
                    </h3>
                    <div className="text-[12.5px] font-semibold text-ink-text-secondary mt-0.5">
                      {cand.vendor_name}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="mono text-[22px] font-bold text-ink-text-primary">
                      {formatINR(cand.price)}
                    </div>
                    <div className="mono text-[11px] text-ink-text-tertiary">3-Day Package</div>
                  </div>
                </div>

                {/* Score Breakdown Strip */}
                <div className="mt-4 rounded-xl bg-ink-surface/60 p-3.5 border border-ink-border/60">
                  <div className="flex items-center justify-between mb-2">
                    <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">
                      Weighted Score:
                    </span>
                    <span className="mono text-[15px] font-bold text-amberx">
                      {scored.score.toFixed(1)} <span className="text-[11px] text-ink-text-tertiary">/ 100</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Suit (30)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.suitability?.toFixed(1) || '0'}
                      </div>
                    </div>
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Avail (20)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.availability?.toFixed(1) || '0'}
                      </div>
                    </div>
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Rel (20)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.reliability?.toFixed(1) || '0'}
                      </div>
                    </div>
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Price (15)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.price?.toFixed(1) || '0'}
                      </div>
                    </div>
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Deliv (10)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.delivery?.toFixed(1) || '0'}
                      </div>
                    </div>
                    <div className="rounded bg-ink-raised/50 p-1.5">
                      <div className="mono text-[9px] text-ink-text-tertiary">Ins (5)</div>
                      <div className="mono text-[11px] font-semibold text-ink-text-primary">
                        {scored.score_breakdown.insurance?.toFixed(1) || '0'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Meta details: distance, delivery, insurance, reliability */}
                <div className="mt-3.5 flex flex-wrap gap-4 text-[11.5px] text-ink-text-secondary">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-ink-text-tertiary" />
                    {cand.location || `${cand.distance_km} km away`}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-ink-text-tertiary" />
                    {cand.delivery_days === 0 ? 'Same day delivery' : `${cand.delivery_days} day dispatch`}
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-amberx" />
                    {cand.reliability_score}% reliability
                  </span>
                  <span className="flex items-center gap-1">
                    {cand.insurance_included ? (
                      <span className="text-greenx flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> Insured
                      </span>
                    ) : (
                      <span className="text-redx flex items-center gap-1">
                        <ShieldAlert className="h-3.5 w-3.5" /> Uninsured
                      </span>
                    )}
                  </span>
                </div>

                {/* Reasons or Rejections */}
                {scored.reasons.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {scored.reasons.map((r, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11.5px] text-greenx">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {scored.rejected_reasons.length > 0 && (
                  <div className="mt-3 rounded-lg bg-redx/10 p-2.5 border border-redx/25 space-y-1">
                    <div className="mono text-[9px] uppercase font-bold text-redx">Rejection Explanations</div>
                    {scored.rejected_reasons.map((rej, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-redx">
                        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{rej}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                {!isRejected ? (
                  <button
                    onClick={() => handleStartNegotiate(cand.vendor_id, cand.resource_id)}
                    disabled={loadingNegotiation === `${cand.vendor_id}-${cand.resource_id}`}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amberx py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 hover:shadow-lg hover:shadow-amberx/20 transition-all"
                  >
                    {loadingNegotiation === `${cand.vendor_id}-${cand.resource_id}` ? (
                      <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                    ) : (
                      <Handshake className="h-4 w-4" />
                    )}
                    Select & Start Negotiation
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full rounded-xl border border-ink-border bg-ink-surface/50 py-2.5 text-[12px] font-semibold text-ink-text-tertiary cursor-not-allowed"
                  >
                    Ineligible under Policy Rules
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
