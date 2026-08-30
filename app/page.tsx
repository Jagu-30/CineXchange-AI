'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINRLakh } from '@/lib/mission-context';
import { isApiError } from '@/lib/api-client';
import { IntegrationStatus } from '@/components/shared/integration-status';
import { SCENARIO } from '@/lib/mockData';
import {
  Clapperboard,
  ArrowRight,
  IndianRupee,
  CalendarDays,
  Sparkles,
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
  MapPin,
  Flame,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AGENT_PILLS = [
  { name: 'Producer Agent', icon: Brain },
  { name: 'Marketplace Scout', icon: Search },
  { name: 'Negotiation Agent', icon: Handshake },
  { name: 'Compliance & Approval', icon: ShieldCheck },
  { name: 'Emergency Recovery', icon: Siren },
];

const PRESETS = [
  {
    title: 'Rainforest Night Shoot',
    location: 'Western Ghats (Agumbe)',
    budget: 2500000,
    days: 3,
    prompt: 'We need to shoot two low-light rainforest scenes over three days within ₹25 lakh with dual-ISO cameras and silent power.',
  },
  {
    title: 'High-Speed Action Chase',
    location: 'Mumbai Sea Link & Bandra',
    budget: 1800000,
    days: 2,
    prompt: 'Action car chase with roving gimbal cameras, tracking rigs, high frame-rate sensors, and city traffic filming permits.',
  },
  {
    title: 'Desert Aerial Epic',
    location: 'Jaisalmer Dunes, Rajasthan',
    budget: 2200000,
    days: 3,
    prompt: '8K full-frame anamorphic cinematic shoot in sand dunes with 8K cinema drone, DGCA night pilot, and desert transport.',
  },
];

/** Default start date: tomorrow, computed at render time — not a fabricated value. */
function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `start_date + days` in `YYYY-MM-DD`, computed locally since the backend wants both dates. */
function addDaysIso(startIso: string, days: number): string {
  const [y, m, d] = startIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Math.max(0, days - 1));
  return dt.toISOString().slice(0, 10);
}

function IntakeFormContent() {
  const router = useRouter();
  const { createProduction, isLoading, error, clearError } = useMission();

  const [description, setDescription] = useState(SCENARIO.description);
  const [budget, setBudget] = useState(SCENARIO.budgetCap);
  const [days, setDays] = useState(SCENARIO.shootDays);
  const [location, setLocation] = useState('Western Ghats rainforest (Agumbe)');
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setDescription(preset.prompt);
    setBudget(preset.budget);
    setDays(preset.days);
    setLocation(preset.location);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationMessage(null);

    const briefText = description.trim();
    if (briefText.length < 10) {
      setValidationMessage('Shoot description must be at least 10 characters — the backend rejects anything shorter.');
      return;
    }

    const endDate = addDaysIso(startDate, days);

    const created = await createProduction({
      brief_text: briefText,
      budget_cap: budget.toFixed(2),
      location,
      start_date: startDate,
      end_date: endDate,
    });

    if (created) {
      router.push('/processing');
    }
  };

  const errorMessage = error
    ? isApiError(error)
      ? error.detail || error.message
      : error.message
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-bg">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-25" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[800px] -translate-x-1/2 rounded-full bg-amberx/8 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-[600px] rounded-full bg-bluex/6 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 left-0 h-64 w-[400px] rounded-full bg-greenx/4 blur-[100px]" />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-12">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amberx/20 to-amberx/5 border border-amberx/30">
              <Clapperboard className="h-5 w-5 text-amberx" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amberx animate-pulse-dot ring-2 ring-ink-bg" />
            </div>
            <div>
              <div className="text-[16px] font-semibold tracking-tight text-ink-text-primary">
                CineXchange <span className="text-amberx">AI</span>
              </div>
              <div className="mono text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
                Autonomous Procurement
              </div>
            </div>
          </div>
          {/* Was a hardcoded "5 AGENTS ONLINE" badge that was never backed by a
              check - it rendered green whether or not a single agent was up.
              This reports real per-agent MCP reachability from GET /healthz.
              Compact: the full panel belongs in a dashboard section, and at
              header size it crowded out the logo and the hero. */}
          <IntegrationStatus compact />
        </header>

        {/* Hero */}
        <div className="mt-12 mb-8">
          <div className="mono mb-3 inline-flex items-center gap-2 rounded-full border border-amberx/25 bg-amberx/5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amberx">
            <Sparkles className="h-3 w-3" />
            Multi-Agent Autonomous Procurement
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink-text-primary sm:text-[38px]">
            Tell the crew what to shoot.
            <br />
            <span className="text-amberx text-glow-amber">The 5 AI agents handle the rest.</span>
          </h1>
          <p className="mt-3.5 max-w-xl text-[13.5px] leading-relaxed text-ink-text-secondary">
            Enter your custom shoot brief in natural language. Five specialized AI agents will dynamically extract specifications, scout verified vendors, negotiate prices, check compliance, and stand by for emergency recovery — autonomously, once you submit.
          </p>
        </div>

        {/* Quick Presets Strip */}
        <div className="mb-6 space-y-2">
          <div className="mono text-[9.5px] uppercase tracking-[0.14em] text-ink-text-tertiary flex items-center gap-1.5">
            <Flame className="h-3 w-3 text-amberx" /> Try Preset Production Scenarios:
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.title}
                type="button"
                onClick={() => applyPreset(p)}
                className="glass card-hover rounded-xl px-3 py-1.5 text-[11.5px] text-ink-text-secondary hover:text-amberx hover:border-amberx/40 transition-all text-left"
              >
                <span className="font-semibold text-ink-text-primary">{p.title}</span>
                <span className="mono text-[10px] text-ink-text-tertiary ml-1.5">({p.location})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-strong rounded-2xl p-8 space-y-6">
          <div>
            <label className="mono mb-2 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
              Shoot Description & Creative Requirements
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-ink-border bg-ink-surface/60 px-4 py-3 text-[13px] leading-relaxed text-ink-text-primary placeholder:text-ink-text-tertiary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
              placeholder="Describe what you want to shoot — scene types, lighting conditions, cameras, gimbal, drone, special constraints…"
              required
              minLength={10}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="mono mb-1.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Budget Cap (₹)
              </label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-text-tertiary" />
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/60 py-2.5 pl-9 pr-3 text-[14px] font-bold text-ink-text-primary focus:border-amberx/40 focus:outline-none transition-all"
                  required
                  min={1}
                />
              </div>
              <p className="mono mt-1 text-[10px] text-amberx">
                {formatINRLakh(budget)} maximum
              </p>
            </div>

            <div>
              <label className="mono mb-1.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Shoot Duration
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-text-tertiary" />
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/60 py-2.5 pl-9 pr-3 text-[14px] font-bold text-ink-text-primary focus:border-amberx/40 focus:outline-none transition-all"
                  required
                  min={1}
                />
              </div>
              <p className="mono mt-1 text-[10px] text-ink-text-tertiary">
                {days} production day(s)
              </p>
            </div>

            <div>
              <label className="mono mb-1.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Start Date
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-text-tertiary" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/60 py-2.5 pl-9 pr-3 text-[13px] font-bold text-ink-text-primary focus:border-amberx/40 focus:outline-none transition-all"
                  required
                />
              </div>
              <p className="mono mt-1 text-[10px] text-ink-text-tertiary truncate">
                Wraps {addDaysIso(startDate, days)}
              </p>
            </div>

            <div>
              <label className="mono mb-1.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Location / Region
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-text-tertiary" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-xl border border-ink-border bg-ink-surface/60 py-2.5 pl-9 pr-3 text-[13px] font-medium text-ink-text-primary focus:border-amberx/40 focus:outline-none transition-all"
                  required
                />
              </div>
              <p className="mono mt-1 text-[10px] text-greenx truncate">
                On-location zone
              </p>
            </div>
          </div>

          {(validationMessage || errorMessage) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-redx/30 bg-redx/10 p-3.5 text-[12.5px] text-redx">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{validationMessage || errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-amberx py-3.5 text-[14px] font-semibold text-ink-bg transition-all duration-300 hover:bg-amberx/90 hover:shadow-xl hover:shadow-amberx/25 hover:-translate-y-0.5 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
            ) : (
              <>
                Launch Autonomous AI Procurement
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

        {/* Agent preview strip */}
        <div className="mt-8">
          <div className="mono mb-2.5 text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
            5 Specialized AI Agents Standing By
          </div>
          <div className="flex flex-wrap gap-2">
            {AGENT_PILLS.map(({ name, icon: Icon }) => (
              <div
                key={name}
                className="glass card-hover flex items-center gap-2 rounded-full px-3.5 py-1.5 hover:border-amberx/30"
              >
                <Icon className="h-3.5 w-3.5 text-amberx" />
                <span className="text-[11px] font-medium text-ink-text-secondary">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntakePage() {
  return <IntakeFormContent />;
}
