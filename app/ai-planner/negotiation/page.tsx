'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR, formatINRLakh } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { NegotiationState } from '@/lib/types';
import {
  Handshake,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Sparkles,
  ArrowRight,
  HelpCircle,
  FileCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function NegotiationPageContent() {
  const router = useRouter();
  const {
    productionState,
    submitCounterOffer,
    acceptOffer,
    runCompliance,
  } = useMission();

  const negotiations: NegotiationState[] = productionState?.negotiations || [];
  const activeNeg = negotiations[0] || {
    negotiation_id: 'NEG-V003-CAM002',
    vendor_id: 'V003',
    resource_id: 'CAM-002',
    initial_price: 480000,
    current_price: 441600,
    target_price: 441600,
    minimum_price: 432000,
    rounds: 1,
    max_rounds: 3,
    target_savings_percent: 8.0,
    minimum_acceptable_quality: 85.0,
    insurance_required: true,
    max_delivery_days: 2,
    status: 'IN_PROGRESS',
    history: [
      {
        round_number: 1,
        offered_by: 'VENDOR',
        price: 480000,
        savings_percent: 0.0,
        included_terms: { insurance: true, delivery_days: 1 },
        message: 'Initial 3-day cinema camera package quote with 2 primes: ₹4,80,000.',
        accepted: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      },
      {
        round_number: 1,
        offered_by: 'PRODUCER',
        price: 422400,
        savings_percent: 12.0,
        included_terms: { insurance: true, delivery_days: 1, warranty: true },
        message: 'Producer proposes 12% discount for confirmed 3-day Agumbe shoot commitment.',
        accepted: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      },
      {
        round_number: 1,
        offered_by: 'VENDOR',
        price: 441600,
        savings_percent: 8.0,
        included_terms: { insurance: true, delivery_days: 1, on_site_tech: true },
        message: 'Vendor agrees to 8% target discount at ₹4,41,600 with on-site technician & full transit insurance.',
        accepted: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      },
    ],
    reasoning: 'Negotiated 8% savings locked with mandatory transit insurance included.',
  };

  const [counterPriceInput, setCounterPriceInput] = useState<number>(
    Math.round(activeNeg.current_price * 0.95),
  );
  const [loading, setLoading] = useState(false);
  const [uninsuredTest, setUninsuredTest] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const initial = activeNeg.initial_price || 480000;
  const current = activeNeg.current_price || 441600;
  const savings = initial - current;
  const savingsPercent = initial > 0 ? (savings / initial) * 100 : 0;
  const isAccepted = activeNeg.status === 'ACCEPTED';
  const isExhausted = activeNeg.rounds >= activeNeg.max_rounds;

  const handleSubmitCounter = async () => {
    setLoading(true);
    setPolicyError(null);
    try {
      const terms = {
        insurance: !uninsuredTest,
        delivery_days: 1,
        warranty: true,
      };
      const res = await submitCounterOffer(activeNeg.negotiation_id, Number(counterPriceInput), terms);
      if (!res) {
        setPolicyError('Policy rejection: Mandatory insurance is missing or counter terms are non-compliant.');
      }
    } catch (err: any) {
      setPolicyError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    setLoading(true);
    await acceptOffer(activeNeg.negotiation_id);
    await runCompliance();
    setLoading(false);
    router.push('/ai-planner/compliance');
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Negotiation Agent Workspace</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Handshake className="h-6 w-6 text-amberx" />
            Vendor Negotiation & Package Optimization
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Simulated multi-round bargaining with ForestFrame Rentals. Deterministic policy enforces 8% target savings, quality &ge; 85, and strictly rejects uninsured packages.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isAccepted ? (
            <button
              onClick={() => router.push('/ai-planner/compliance')}
              className="flex items-center gap-2 rounded-xl bg-greenx px-6 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20 transition-all"
            >
              <ShieldCheck className="h-4 w-4" />
              Proceed to Compliance & Risk Center
            </button>
          ) : (
            <button
              onClick={handleAccept}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-amberx px-6 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Accept Valid Package
            </button>
          )}
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Negotiate" />

      {/* Stat Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-xl p-5 border border-ink-border">
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Initial Quote</div>
          <div className="mono text-[20px] font-bold text-ink-text-primary mt-1 line-through decoration-ink-border">
            {formatINR(initial)}
          </div>
          <div className="text-[11px] text-ink-text-tertiary mt-0.5">List price</div>
        </div>

        <div className="glass rounded-xl p-5 border border-amberx/30 glow-amber">
          <div className="mono text-[10px] uppercase tracking-wider text-amberx font-semibold">Current Best Offer</div>
          <div className="mono text-[22px] font-bold text-amberx mt-1">
            {formatINR(current)}
          </div>
          <div className="mono text-[11px] text-greenx mt-0.5">
            -{savingsPercent.toFixed(1)}% savings locked
          </div>
        </div>

        <div className="glass rounded-xl p-5 border border-greenx/20">
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Total Savings</div>
          <div className="mono text-[20px] font-bold text-greenx mt-1 flex items-center gap-1">
            <TrendingDown className="h-4 w-4" />
            {formatINR(savings)}
          </div>
          <div className="text-[11px] text-greenx mt-0.5">Within target 8% envelope</div>
        </div>

        <div className="glass rounded-xl p-5 border border-ink-border">
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Negotiation Round</div>
          <div className="mono text-[20px] font-bold text-ink-text-primary mt-1">
            Round {activeNeg.rounds} / {activeNeg.max_rounds}
          </div>
          <div className="mono text-[11px] text-ink-text-secondary mt-0.5">
            Status: <span className="font-bold text-amberx">{activeNeg.status}</span>
          </div>
        </div>
      </div>

      {policyError && (
        <div className="glass rounded-xl p-4 border-redx/30 bg-redx/10 flex items-center gap-3 text-[13px] text-redx">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <div className="font-bold">Policy Constraint Violation</div>
            <div>{policyError}</div>
          </div>
        </div>
      )}

      {/* Main Negotiation Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left 2 Cols: Dialogue History & Counter Generator */}
        <div className="xl:col-span-2 space-y-6">
          {/* Timeline dialogue */}
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
            <div className="flex items-center justify-between border-b border-ink-border/50 pb-3">
              <h2 className="text-[16px] font-semibold text-ink-text-primary flex items-center gap-2">
                <Handshake className="h-4.5 w-4.5 text-amberx" />
                Negotiation Exchange History
              </h2>
              <span className="mono text-[11px] text-ink-text-tertiary">
                Vendor: {activeNeg.vendor_id} · Resource: {activeNeg.resource_id}
              </span>
            </div>

            <div className="space-y-4">
              {(activeNeg.history || []).map((rnd, i) => {
                const isProducer = rnd.offered_by === 'PRODUCER';
                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-xl p-4 border transition-all flex flex-col space-y-2',
                      isProducer
                        ? 'bg-amberx/10 border-amberx/25 ml-6'
                        : 'bg-ink-surface/70 border-ink-border mr-6',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full',
                            isProducer ? 'bg-amberx text-ink-bg' : 'bg-ink-raised text-bluex',
                          )}
                        >
                          {rnd.offered_by} · Round {rnd.round_number}
                        </span>
                        {rnd.accepted && (
                          <span className="mono text-[10px] bg-greenx/20 text-greenx px-2 py-0.5 rounded-full font-bold">
                            Agreed
                          </span>
                        )}
                      </div>
                      <span className="mono text-[15px] font-bold text-ink-text-primary">
                        {formatINR(rnd.price)}
                      </span>
                    </div>

                    <p className="text-[12.5px] leading-relaxed text-ink-text-primary">
                      {rnd.message}
                    </p>

                    {rnd.included_terms && Object.keys(rnd.included_terms).length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {Object.entries(rnd.included_terms).map(([k, v]) => (
                          <span
                            key={k}
                            className="mono text-[10px] px-2 py-0.5 rounded bg-ink-surface text-ink-text-secondary border border-ink-border"
                          >
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Counter-Offer Panel */}
          {!isAccepted && !isExhausted && (
            <div className="glass rounded-2xl p-7 border border-amberx/30 space-y-5">
              <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amberx" />
                Submit Counter-Offer (Round {activeNeg.rounds + 1} of {activeNeg.max_rounds})
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mono block text-[10px] uppercase tracking-wider text-ink-text-tertiary mb-1.5">
                    Proposed Counter Price (₹)
                  </label>
                  <input
                    type="number"
                    value={counterPriceInput}
                    onChange={(e) => setCounterPriceInput(Number(e.target.value))}
                    className="mono w-full rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[15px] font-bold text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                  />
                  <p className="mono text-[10px] text-ink-text-tertiary mt-1">
                    Target ceiling: {formatINR(activeNeg.target_price)}
                  </p>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 p-3 glass rounded-xl border border-ink-border cursor-pointer hover:border-ink-border-strong">
                    <input
                      type="checkbox"
                      checked={uninsuredTest}
                      onChange={(e) => setUninsuredTest(e.target.checked)}
                      className="rounded border-ink-border text-amberx focus:ring-0"
                    />
                    <span className="text-[12px] text-ink-text-secondary">
                      Simulate cheap uninsured package (Policy Test)
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleSubmitCounter}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl bg-amberx px-6 py-3 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Submit Counter-Offer
                </button>

                <button
                  onClick={handleAccept}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-5 py-3 text-[13px] font-semibold text-greenx hover:bg-greenx/10 hover:border-greenx/30 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4 text-greenx" />
                  Accept Current Offer ({formatINR(current)})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Deterministic Negotiation Policy Details */}
        <div className="xl:col-span-1 space-y-6">
          <div className="glass rounded-2xl p-6 border border-ink-border space-y-4">
            <h3 className="text-[14px] font-semibold text-ink-text-primary flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-greenx" />
              Negotiation Policy Rules
            </h3>
            <p className="text-[11.5px] text-ink-text-secondary leading-relaxed">
              Deterministic Python guardrails govern every counter-offer:
            </p>

            <div className="space-y-2.5 text-[12px]">
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                <CheckCircle2 className="h-4 w-4 text-greenx shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-ink-text-primary">Target Savings: 8.0%</div>
                  <div className="text-[11px] text-ink-text-tertiary">
                    Target rate ₹{formatINR(activeNeg.target_price)} locks optimal budget efficiency.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                <CheckCircle2 className="h-4 w-4 text-greenx shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-ink-text-primary">Mandatory Insurance</div>
                  <div className="text-[11px] text-ink-text-tertiary">
                    Offers lacking insurance are strictly REJECTED regardless of price.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                <CheckCircle2 className="h-4 w-4 text-greenx shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-ink-text-primary">Quality Standard: &ge; 85</div>
                  <div className="text-[11px] text-ink-text-tertiary">
                    Minimum cinema sensor ISO and glass MTF rating must be preserved.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-ink-surface/60 border border-ink-border">
                <CheckCircle2 className="h-4 w-4 text-greenx shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-ink-text-primary">Max 3 Rounds</div>
                  <div className="text-[11px] text-ink-text-tertiary">
                    Prevents deadlocks. Escalates to producer if no concession by Round 3.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
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
