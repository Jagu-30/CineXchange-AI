'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SCENARIO } from '@/lib/mockData';
import { Clapperboard, ArrowRight, IndianRupee, CalendarDays, Sparkles, Brain, Search, Handshake, ShieldCheck, Siren } from 'lucide-react';

const AGENT_PILLS = [
  { name: 'Producer Agent', icon: Brain },
  { name: 'Marketplace Scout', icon: Search },
  { name: 'Negotiation Agent', icon: Handshake },
  { name: 'Compliance & Approval', icon: ShieldCheck },
  { name: 'Emergency Recovery', icon: Siren },
];

export default function IntakePage() {
  const router = useRouter();
  const [description, setDescription] = useState(SCENARIO.description);
  const [budget, setBudget] = useState(SCENARIO.budgetCap);
  const [days, setDays] = useState(SCENARIO.shootDays);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push('/processing');
  };

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
                Procurement Control
              </div>
            </div>
          </div>
          <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-greenx animate-pulse-dot" />
            <span className="mono text-[10px] font-medium text-greenx">SYSTEM ONLINE</span>
          </div>
        </header>

        {/* Hero */}
        <div className="mt-14 mb-10">
          <div className="mono mb-4 inline-flex items-center gap-2 rounded-full border border-amberx/25 bg-amberx/5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amberx">
            <Sparkles className="h-3 w-3" />
            Multi-Agent Procurement
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink-text-primary sm:text-[40px]">
            Tell the crew what to shoot.
            <br />
            <span className="text-amberx text-glow-amber">The agents handle the rest.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-text-secondary">
            Describe your shoot in plain language. Five AI agents will break it into
            requirements, source vendors, negotiate prices, check compliance, and stand
            by for on-site recovery — all within your budget cap.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-strong rounded-2xl p-8 space-y-7">
          <div>
            <label className="mono mb-2.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
              Shoot Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full resize-none rounded-xl border border-ink-border bg-ink-surface/60 px-4 py-3.5 text-[13px] leading-relaxed text-ink-text-primary placeholder:text-ink-text-tertiary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
              placeholder="Describe the shoot — locations, scenes, crew size, special equipment, constraints…"
            />
            <p className="mt-2 text-[11px] text-ink-text-tertiary">
              Editable default — change anything to match your production.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="mono mb-2.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Budget Cap (₹)
              </label>
              <div className="relative">
                <IndianRupee className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-text-tertiary" />
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/60 py-3 pl-11 pr-4 text-[15px] font-medium text-ink-text-primary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
                />
              </div>
              <p className="mono mt-2 text-[11px] text-ink-text-tertiary">
                {(budget / 100000).toFixed(2)}L ceiling
              </p>
            </div>
            <div>
              <label className="mono mb-2.5 block text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
                Shoot Days
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-text-tertiary" />
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="mono w-full rounded-xl border border-ink-border bg-ink-surface/60 py-3 pl-11 pr-4 text-[15px] font-medium text-ink-text-primary focus:border-amberx/40 focus:outline-none focus:ring-2 focus:ring-amberx/15 transition-all"
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-text-tertiary">
                {days}-day production window
              </p>
            </div>
          </div>

          <button
            type="submit"
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-amberx py-3.5 text-[14px] font-semibold text-ink-bg transition-all duration-300 hover:bg-amberx/90 hover:shadow-xl hover:shadow-amberx/25 hover:-translate-y-0.5"
          >
            Submit request
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </form>

        {/* Agent preview strip */}
        <div className="mt-10">
          <div className="mono mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">
            5 Agents standing by
          </div>
          <div className="flex flex-wrap gap-2.5">
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
