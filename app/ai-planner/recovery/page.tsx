'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { RecoveryOption, Incident } from '@/lib/types';
import {
  Siren,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MapPin,
  Clock,
  Star,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  Zap,
  Play,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function RecoveryPageContent() {
  const router = useRouter();
  const {
    productionState,
    triggerIncident,
    runRecovery,
    approveRecovery,
  } = useMission();

  const [simulating, setSimulating] = useState(false);
  const [approving, setApproving] = useState(false);

  const incidents: Incident[] = productionState?.incidents || [];
  const latestIncident = incidents[0] || {
    incident_id: 'INC-001',
    event: 'RESOURCE_UNAVAILABLE',
    resource_id: 'CAM-001',
    occurred_at: new Date().toISOString(),
    severity: 'HIGH',
    details: { message: 'ARRI Alexa Mini LF reported sensor failure at camera position A' },
  };

  const recoveryOptions: RecoveryOption[] = productionState?.recovery_options || [
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
      compatibility_score: 30.0,
      availability_score: 20.0,
      schedule_score: 20.0,
      cost_score: 13.0,
      reliability_score: 9.8,
      insurance_score: 5.0,
      total_score: 97.8,
      cost_delta: 8000,
      schedule_delay_days: 0,
      reasons: ['Low-light compatible (Dual Base ISO)', 'Available today', '12 km from location', 'Insurance included'],
      risks: ['+₹8,000 cost delta over original line'],
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
      compatibility_score: 12.0,
      availability_score: 20.0,
      schedule_score: 0.0,
      cost_score: 15.0,
      reliability_score: 7.0,
      insurance_score: 0.0,
      total_score: 54.0,
      cost_delta: -160000,
      schedule_delay_days: 2,
      reasons: [],
      risks: [
        'Lacks low-light dual-ISO sensitivity',
        '2 days delivery delay',
        'No equipment insurance',
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
        included_services: ['Cooke Primes'],
        specifications: { low_light: true },
      },
      compatibility_score: 30.0,
      availability_score: 0.0,
      schedule_score: 10.0,
      cost_score: 10.0,
      reliability_score: 9.5,
      insurance_score: 5.0,
      total_score: 64.5,
      cost_delta: 40000,
      schedule_delay_days: 1,
      reasons: ['Low-light compatible'],
      risks: ['Currently booked on another production set (Unavailable)'],
    },
  ];

  const topOption = recoveryOptions[0];
  const isRecovered = productionState?.current_state === 'RECOVERY_APPROVED' || (productionState?.bookings || []).some(b => b.resource_id === 'CAM-002');

  const handleSimulate = async () => {
    setSimulating(true);
    await triggerIncident('CAM-001', 'ARRI Alexa Mini LF sensor malfunction mid-shoot');
    await runRecovery();
    setSimulating(false);
  };

  const handleApproveRecovery = async () => {
    setApproving(true);
    await approveRecovery(topOption?.candidate?.resource_id || 'CAM-002');
    setApproving(false);
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-redx font-semibold">· Emergency Incident Response</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Siren className="h-6 w-6 text-redx animate-pulse-dot" />
            Emergency Recovery Center
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Autonomous re-sourcing and ranking when equipment fails mid-shoot. Weighs compatibility (30%), availability (20%), schedule impact (20%), cost (15%), and reliability (10%).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSimulate}
            disabled={simulating}
            className="flex items-center gap-2 rounded-xl border border-redx/30 bg-redx/10 px-5 py-2.5 text-[13px] font-semibold text-redx hover:bg-redx/20 transition-all disabled:opacity-50"
          >
            {simulating ? (
              <span className="h-4 w-4 rounded-full border-2 border-redx border-t-transparent animate-spin-slow" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Trigger Camera Failure (CAM-001)
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Recovery" />

      {/* Incident Banner */}
      <div className="glass-strong rounded-2xl p-6 border border-redx/40 glow-alert flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-redx/15 text-redx">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-redx/20 text-redx">
                SEVERITY: {latestIncident.severity}
              </span>
              <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                SOURCE: {latestIncident.details?.source || 'Grafana Cloud MCP (OnCall)'}
              </span>
              <span className="mono text-[11px] text-ink-text-tertiary">
                Incident ID: <strong className="text-redx font-mono">{latestIncident.incident_id || 'INC-GRAFANA-001'}</strong>
              </span>
            </div>
            <h2 className="text-[16px] font-bold text-ink-text-primary mt-1">
              Active Incident: Booked Camera Unavailable (CAM-001)
            </h2>
            <p className="text-[12.5px] text-ink-text-secondary mt-0.5">
              {latestIncident.details?.message || 'ARRI Alexa Mini LF sensor overheated and failed during rainforest night shoot in Agumbe.'}
            </p>
          </div>
        </div>

        <div className="glass rounded-xl p-4 border border-redx/30 shrink-0 text-right">
          <div className="mono text-[10px] uppercase text-ink-text-tertiary">Schedule Impact Without Recovery</div>
          <div className="mono text-[18px] font-bold text-redx mt-0.5">1-Day Production Delay</div>
          <div className="text-[11px] text-ink-text-tertiary">~₹4.5L idle crew loss</div>
        </div>
      </div>

      {/* Recovery Trade-Off Explanation Callout */}
      {topOption && (
        <div className="glass-strong rounded-2xl p-6 border border-amberx/30 glow-amber space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amberx font-semibold text-[14px]">
              <Sparkles className="h-4.5 w-4.5" />
              Autonomous Agent Recovery Recommendation (Grafana Telemetry Triggered)
            </div>
            <span className="mono text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
              GRAFANA MCP RECOVERY
            </span>
          </div>
          <p className="text-[13.5px] leading-relaxed text-ink-text-primary font-medium">
            &ldquo;Grafana detected a critical incident affecting <span className="text-redx font-bold">CAM-001</span>. <span className="text-amberx font-bold">CAM-002</span> costs{' '}
            <span className="text-amberx font-bold">+₹8,000 more</span>, but it is{' '}
            <span className="text-greenx font-bold">12 km away</span>, <span className="text-greenx font-bold">available today</span>,{' '}
            <span className="text-greenx font-bold">low-light compatible</span>, and causes{' '}
            <span className="text-greenx font-bold">zero schedule delay</span>.&rdquo;
          </p>
          <div className="flex flex-wrap gap-4 pt-1 text-[11.5px] text-ink-text-secondary">
            <span className="flex items-center gap-1 text-greenx">
              <CheckCircle2 className="h-3.5 w-3.5" /> Zero Schedule Delay
            </span>
            <span className="flex items-center gap-1 text-amberx">
              <Clock className="h-3.5 w-3.5" /> 2-Hour Emergency Dispatch (12 km away)
            </span>
            <span className="flex items-center gap-1 text-greenx">
              <ShieldCheck className="h-3.5 w-3.5" /> Dual-Base ISO 4000 (Low-Light)
            </span>
            <span className="flex items-center gap-1 text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Grafana OnCall Verified
            </span>
          </div>
        </div>
      )}

      {/* Ranked Recovery Options Grid */}
      <div className="space-y-4">
        <h3 className="text-[16px] font-semibold text-ink-text-primary flex items-center gap-2">
          <Zap className="h-4.5 w-4.5 text-amberx" />
          Ranked Replacement Options ({recoveryOptions.length})
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {recoveryOptions.map((opt, i) => {
            const cand = opt.candidate;
            const isSelected = i === 0;
            const isUnsuitable = opt.total_score < 70.0;

            return (
              <div
                key={cand.resource_id}
                className={cn(
                  'glass card-hover rounded-2xl p-6 border transition-all flex flex-col justify-between space-y-5',
                  isSelected
                    ? 'border-amberx/40 glow-amber bg-amberx/5'
                    : isUnsuitable
                      ? 'border-redx/30 opacity-70'
                      : 'border-ink-border',
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full bg-ink-surface text-ink-text-primary border border-ink-border">
                      Rank #{i + 1} · {cand.resource_id}
                    </span>
                    {isSelected && (
                      <span className="mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amberx text-ink-bg">
                        Top Recovery Choice
                      </span>
                    )}
                  </div>

                  <h4 className="text-[15px] font-bold text-ink-text-primary mt-2">
                    {cand.resource_name}
                  </h4>
                  <div className="text-[12px] font-semibold text-ink-text-secondary">
                    {cand.vendor_name}
                  </div>

                  <div className="mt-4 rounded-xl bg-ink-surface/70 p-3 border border-ink-border/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Recovery Score:</span>
                      <span className="mono text-[15px] font-bold text-amberx">{opt.total_score.toFixed(1)} / 100</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-[10.5px]">
                      <div className="bg-ink-raised/50 p-1 rounded">
                        <div className="mono text-[9px] text-ink-text-tertiary">Compat</div>
                        <div className="mono font-bold text-ink-text-primary">{opt.compatibility_score.toFixed(1)}</div>
                      </div>
                      <div className="bg-ink-raised/50 p-1 rounded">
                        <div className="mono text-[9px] text-ink-text-tertiary">Schedule</div>
                        <div className="mono font-bold text-ink-text-primary">{opt.schedule_score.toFixed(1)}</div>
                      </div>
                      <div className="bg-ink-raised/50 p-1 rounded">
                        <div className="mono text-[9px] text-ink-text-tertiary">Cost</div>
                        <div className="mono font-bold text-ink-text-primary">{opt.cost_score.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Pricing and Delta */}
                  <div className="mt-3.5 flex items-baseline justify-between border-b border-ink-border/50 pb-3">
                    <div>
                      <div className="mono text-[18px] font-bold text-ink-text-primary">{formatINR(cand.price)}</div>
                      <div className="text-[10px] text-ink-text-tertiary">3-Day Rental</div>
                    </div>
                    <div className="text-right">
                      <div className={cn('mono text-[13px] font-bold', opt.cost_delta > 0 ? 'text-amberx' : 'text-greenx')}>
                        {opt.cost_delta > 0 ? `+${formatINR(opt.cost_delta)}` : formatINR(opt.cost_delta)}
                      </div>
                      <div className="text-[10px] text-ink-text-tertiary">Cost Delta vs Original</div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-[11.5px]">
                    <div className="flex items-center gap-1.5 text-ink-text-secondary">
                      <MapPin className="h-3.5 w-3.5 text-ink-text-tertiary" />
                      {cand.location || `${cand.distance_km} km away`}
                    </div>
                    <div className="flex items-center gap-1.5 text-ink-text-secondary">
                      <Clock className="h-3.5 w-3.5 text-ink-text-tertiary" />
                      {opt.schedule_delay_days === 0 ? '0 Delay (Delivered Today)' : `${opt.schedule_delay_days} day delay`}
                    </div>
                  </div>

                  {opt.reasons.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {opt.reasons.map((r, idx) => (
                        <div key={idx} className="flex items-center gap-1 text-[11px] text-greenx">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {opt.risks.length > 0 && (
                    <div className="mt-2.5 rounded-lg bg-redx/10 p-2 border border-redx/25 space-y-0.5">
                      {opt.risks.map((rk, idx) => (
                        <div key={idx} className="flex items-start gap-1 text-[11px] text-redx">
                          <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span>{rk}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  {isSelected ? (
                    <button
                      onClick={handleApproveRecovery}
                      disabled={approving || isRecovered}
                      className={cn(
                        'w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-semibold transition-all',
                        isRecovered
                          ? 'bg-greenx/20 text-greenx border border-greenx/30 cursor-default'
                          : 'bg-greenx text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20',
                      )}
                    >
                      {approving ? (
                        <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                      ) : isRecovered ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {isRecovered ? 'Recovery Approved & Dispatched' : 'Approve Replacement (+₹8,000 Delta)'}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full rounded-xl border border-ink-border bg-ink-surface/40 py-2.5 text-[12px] font-semibold text-ink-text-tertiary cursor-not-allowed"
                    >
                      Non-Recommended Alternative
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
