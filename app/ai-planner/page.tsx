'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMission, formatINR, formatINRLakh } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import { AgentActivityTimeline } from '@/components/shared/agent-activity-timeline';
import {
  Sparkles,
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
  ArrowRight,
  Play,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  CalendarDays,
  MapPin,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { IntegrationStatus } from '@/components/shared/integration-status';

function PlannerHubContent() {
  const router = useRouter();
  const {
    productionState,
    isLoading,
    error,
    refreshState,
    planProject,
    runScout,
    startNegotiation,
    runCompliance,
    triggerIncident,
    runRecovery,
  } = useMission();

  const [briefInput, setBriefInput] = useState(
    productionState?.project?.producer_request ||
      'We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.',
  );
  const [budgetInput, setBudgetInput] = useState(productionState?.project?.budget || 2500000);
  const [durationInput, setDurationInput] = useState(productionState?.project?.duration_days || 3);
  const [locationInput, setLocationInput] = useState(productionState?.project?.location || 'Western Ghats rainforest');

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const currentState = productionState?.current_state || 'DRAFT';
  const reqCount = productionState?.requirements?.length || 0;
  const candidateCount = productionState?.candidates?.length || 0;
  const auditEntries = productionState?.audit_log || [];

  const handleRunProducer = async () => {
    setActionLoading('producer');
    await planProject({
      producer_request: briefInput,
      budget: Number(budgetInput),
      duration_days: Number(durationInput),
      location: locationInput,
    });
    setActionLoading(null);
    router.push('/ai-planner/requirements');
  };

  const handleRunFullPipeline = async () => {
    setActionLoading('full');
    // 1. Plan
    await planProject({
      producer_request: briefInput,
      budget: Number(budgetInput),
      duration_days: Number(durationInput),
      location: locationInput,
    });
    // 2. Scout
    await runScout();
    // 3. Negotiate
    await startNegotiation('V003', 'CAM-002');
    // 4. Compliance
    await runCompliance();
    setActionLoading(null);
    router.push('/ai-planner/compliance');
  };

  const handleRunScout = async () => {
    setActionLoading('scout');
    await runScout();
    setActionLoading(null);
    router.push('/ai-planner/marketplace');
  };

  const handleRunNegotiation = async () => {
    setActionLoading('negotiation');
    await startNegotiation('V003', 'CAM-002');
    setActionLoading(null);
    router.push('/ai-planner/negotiation');
  };

  const handleRunCompliance = async () => {
    setActionLoading('compliance');
    await runCompliance();
    setActionLoading(null);
    router.push('/ai-planner/compliance');
  };

  const handleTriggerEmergency = async () => {
    setActionLoading('recovery');
    await triggerIncident('CAM-001', 'ARRI Alexa Mini LF reported sensor failure mid-shoot in Agumbe');
    await runRecovery();
    setActionLoading(null);
    router.push('/ai-planner/recovery');
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· State: {currentState}</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary">
            AI Production Planner
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Autonomous multi-agent orchestration for film and cinema procurement. Five AI agents
            extract requirements, scout vendors, negotiate packages, enforce compliance, and resolve emergencies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshState()}
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

      {/* Integration Status (Grafana, ClickHouse, Agent Platform) */}
      <IntegrationStatus />

      {error && (
        <div className="glass rounded-xl p-4 border-redx/30 bg-redx/10 flex items-center gap-3 text-[13px] text-redx">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Overview Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass card-hover rounded-xl p-5 border border-amberx/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Budget Ceiling</span>
            <Wallet className="h-4 w-4 text-amberx" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {formatINR(budgetInput)}
          </div>
          <div className="mono text-[11px] text-amberx mt-1">
            {formatINRLakh(budgetInput)} allocated
          </div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-bluex/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Shoot Window</span>
            <CalendarDays className="h-4 w-4 text-bluex" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {durationInput} Days
          </div>
          <div className="text-[11px] text-ink-text-secondary mt-1">
            3 consecutive night shoots
          </div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-greenx/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Requirements</span>
            <Brain className="h-4 w-4 text-greenx" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {reqCount > 0 ? reqCount : '9 Extracted'}
          </div>
          <div className="text-[11px] text-greenx mt-1">
            Camera, Lighting, Power, Drone, Permits
          </div>
        </div>

        <div className="glass card-hover rounded-xl p-5 border border-purple-500/20">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Scouted Vendors</span>
            <Search className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mono text-[22px] font-bold text-ink-text-primary mt-2">
            {candidateCount > 0 ? candidateCount : '5 Ranked'}
          </div>
          <div className="text-[11px] text-purple-400 mt-1">
            Top match: ForestFrame (98% rel)
          </div>
        </div>
      </div>

      {/* Main Action Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left 2 Cols: Shoot Brief Input & Agent Pipeline */}
        <div className="xl:col-span-2 space-y-8">
          {/* Intake Card */}
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amberx/15 text-amberx">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-ink-text-primary">
                    Production Shoot Brief
                  </h2>
                  <p className="text-[11.5px] text-ink-text-tertiary">
                    Enter natural language requirements. Producer Agent will structure them deterministically.
                  </p>
                </div>
              </div>
              <span className="mono text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full bg-amberx/10 text-amberx border border-amberx/20">
                Producer Agent Ready
              </span>
            </div>

            {/* Preset Scenarios */}
            <div className="space-y-1.5">
              <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Quick Production Presets:
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    title: 'Rainforest Night Shoot',
                    loc: 'Western Ghats (Agumbe)',
                    b: 2500000,
                    d: 3,
                    p: 'We need to shoot two low-light rainforest scenes over three days within ₹25 lakh with dual-ISO cameras and silent power.',
                  },
                  {
                    title: 'Action Car Chase',
                    loc: 'Mumbai Sea Link',
                    b: 1800000,
                    d: 2,
                    p: 'Action car chase with roving gimbal cameras, tracking rigs, high frame-rate sensors, and city traffic filming permits.',
                  },
                  {
                    title: 'Desert Aerial Epic',
                    loc: 'Jaisalmer Dunes',
                    b: 2200000,
                    d: 3,
                    p: '8K full-frame anamorphic cinematic shoot in sand dunes with 8K cinema drone, DGCA night pilot, and desert transport.',
                  },
                ].map((preset) => (
                  <button
                    key={preset.title}
                    type="button"
                    onClick={() => {
                      setBriefInput(preset.p);
                      setBudgetInput(preset.b);
                      setDurationInput(preset.d);
                      setLocationInput(preset.loc);
                    }}
                    className="glass card-hover rounded-lg px-2.5 py-1 text-[11px] text-ink-text-secondary hover:text-amberx hover:border-amberx/40 transition-all text-left"
                  >
                    <span className="font-semibold text-ink-text-primary">{preset.title}</span>
                    <span className="mono text-[9.5px] text-ink-text-tertiary ml-1">({preset.loc})</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-2">
                Shoot Brief & Constraints
              </label>
              <textarea
                value={briefInput}
                onChange={(e) => setBriefInput(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-ink-border bg-ink-surface/70 px-4 py-3 text-[13px] leading-relaxed text-ink-text-primary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
                placeholder="Describe your film production requirements..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Budget Cap (₹)
                </label>
                <input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[14px] font-semibold text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Shoot Duration (Days)
                </label>
                <input
                  type="number"
                  value={durationInput}
                  onChange={(e) => setDurationInput(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[14px] font-semibold text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="mono block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary mb-1.5">
                  Shoot Location
                </label>
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="w-full rounded-xl border border-ink-border bg-ink-surface/70 px-3.5 py-2.5 text-[13px] text-ink-text-primary focus:border-amberx/40 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={handleRunFullPipeline}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amberx to-amber-500 px-6 py-3 text-[13px] font-semibold text-ink-bg hover:opacity-95 hover:shadow-xl hover:shadow-amberx/25 transition-all duration-300 disabled:opacity-50"
              >
                {actionLoading === 'full' ? (
                  <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run Full Autonomous AI Pipeline
              </button>

              <button
                onClick={handleRunProducer}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 rounded-xl border border-amberx/40 bg-amberx/10 px-5 py-3 text-[13px] font-semibold text-amberx hover:bg-amberx/20 transition-all duration-300 disabled:opacity-50"
              >
                {actionLoading === 'producer' ? (
                  <span className="h-4 w-4 rounded-full border-2 border-amberx border-t-transparent animate-spin-slow" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Extract Requirements Only
              </button>

              <button
                onClick={handleRunScout}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface/80 px-5 py-3 text-[13px] font-semibold text-ink-text-primary hover:border-ink-border-strong hover:bg-ink-raised transition-all disabled:opacity-50"
              >
                {actionLoading === 'scout' ? (
                  <span className="h-4 w-4 rounded-full border-2 border-ink-text-primary border-t-transparent animate-spin-slow" />
                ) : (
                  <Search className="h-4 w-4 text-bluex" />
                )}
                Run Marketplace Scout
              </button>
            </div>
          </div>

          {/* 5 Agent Workflow Interactive Quick Triggers */}
          <div className="glass rounded-2xl p-7 border border-ink-border space-y-5">
            <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amberx" />
              Agent Workflow Interactive Pipeline
            </h3>
            <p className="text-[12px] text-ink-text-secondary">
              Directly execute or review each specialized agent stage of the production:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Agent 1 */}
              <div className="glass card-hover rounded-xl p-4 border border-ink-border flex flex-col justify-between space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amberx/15 text-amberx">
                    <Brain className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink-text-primary">1. Producer Agent</div>
                    <p className="text-[11.5px] text-ink-text-secondary mt-0.5">
                      Extracts 9 equipment, logistics, crew & compliance requirements with technical specs.
                    </p>
                  </div>
                </div>
                <Link
                  href="/ai-planner/requirements"
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amberx hover:underline"
                >
                  Review Requirements <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Agent 2 */}
              <div className="glass card-hover rounded-xl p-4 border border-ink-border flex flex-col justify-between space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bluex/15 text-bluex">
                    <Search className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink-text-primary">2. Marketplace Scout</div>
                    <p className="text-[11.5px] text-ink-text-secondary mt-0.5">
                      Applies 6-factor ranking & hard filters (low-light, quality &gt;= 85, insurance).
                    </p>
                  </div>
                </div>
                <Link
                  href="/ai-planner/marketplace"
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-bluex hover:underline"
                >
                  Scout Vendors <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Agent 3 */}
              <div className="glass card-hover rounded-xl p-4 border border-ink-border flex flex-col justify-between space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amberx/15 text-amberx">
                    <Handshake className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink-text-primary">3. Negotiation Agent</div>
                    <p className="text-[11.5px] text-ink-text-secondary mt-0.5">
                      Multi-round counter-offers for 8% target savings. Enforces mandatory insurance policy.
                    </p>
                  </div>
                </div>
                <Link
                  href="/ai-planner/negotiation"
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amberx hover:underline"
                >
                  Negotiate Packages <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Agent 4 */}
              <div className="glass card-hover rounded-xl p-4 border border-ink-border flex flex-col justify-between space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-greenx/15 text-greenx">
                    <ShieldCheck className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink-text-primary">4. Compliance & Risk</div>
                    <p className="text-[11.5px] text-ink-text-secondary mt-0.5">
                      5-dimension risk matrix, insurance & forest permit extraction, approval threshold.
                    </p>
                  </div>
                </div>
                <Link
                  href="/ai-planner/compliance"
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-greenx hover:underline"
                >
                  Verify Compliance <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Agent 5 */}
              <div className="glass card-hover rounded-xl p-4 border border-redx/30 glow-alert flex flex-col justify-between space-y-3 md:col-span-2">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-redx/15 text-redx">
                    <Siren className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink-text-primary flex items-center gap-2">
                      <span>5. Emergency Recovery Agent</span>
                      <span className="mono text-[9px] bg-redx/20 text-redx px-2 py-0.5 rounded-full font-bold">
                        ON CALL
                      </span>
                    </div>
                    <p className="text-[11.5px] text-ink-text-secondary mt-0.5">
                      Simulate on-set camera failure (CAM-001) mid-shoot and trigger immediate replacement ranking (CAM-002, +₹8,000 delta, 0 delay).
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={handleTriggerEmergency}
                    disabled={actionLoading !== null}
                    className="flex items-center gap-2 rounded-lg bg-redx px-4 py-2 text-[12px] font-semibold text-ink-bg hover:bg-redx/90 transition-all"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Simulate Camera Failure & Recover
                  </button>
                  <Link
                    href="/ai-planner/recovery"
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-redx hover:underline"
                  >
                    Open Recovery Center <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Live Agent Activity Stream */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary flex items-center gap-2">
              <Clock className="h-4 w-4 text-amberx" />
              Live Agent Stream
            </h3>
            <Link
              href="/ai-planner/audit"
              className="mono text-[10px] text-amberx hover:underline"
            >
              View Full Audit →
            </Link>
          </div>

          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
            <AgentActivityTimeline entries={auditEntries} />
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
