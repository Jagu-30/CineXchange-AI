'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Brain, Search, Handshake, ShieldCheck, Siren,
  Loader2, Check, type LucideIcon,
} from 'lucide-react';

interface Step {
  agent: string;
  title: string;
  icon: LucideIcon;
  duration: number;
}

const STEPS: Step[] = [
  { agent: 'Producer Agent', title: 'Parsing shoot brief into production requirements', icon: Brain, duration: 1100 },
  { agent: 'Marketplace Scout Agent', title: 'Searching simulated vendor marketplace', icon: Search, duration: 1300 },
  { agent: 'Negotiation Agent', title: 'Negotiating improved prices & bundles', icon: Handshake, duration: 1000 },
  { agent: 'Compliance & Approval Agent', title: 'Checking permits, insurance & delivery windows', icon: ShieldCheck, duration: 1200 },
  { agent: 'Emergency Recovery Agent', title: 'Initializing on-call recovery monitor', icon: Siren, duration: 900 },
];

export default function ProcessingPage() {
  const router = useRouter();
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<boolean[]>(STEPS.map(() => false));

  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;

    STEPS.forEach((step, i) => {
      const startAt = elapsed;
      timeouts.push(setTimeout(() => { if (!cancelled) setCurrent(i); }, startAt));
      elapsed += step.duration;
      timeouts.push(setTimeout(() => {
        if (cancelled) return;
        setDone((prev) => { const n = [...prev]; n[i] = true; return n; });
      }, elapsed));
    });

    timeouts.push(setTimeout(() => { if (!cancelled) router.push('/ai-planner/requirements'); }, elapsed + 600));

    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, [router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-bg">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-80 w-[700px] -translate-x-1/2 rounded-full bg-amberx/8 blur-[140px]" />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-10">
        <div className="mb-12 text-center">
          <div className="mono mb-4 inline-flex items-center gap-2 rounded-full border border-amberx/25 bg-amberx/5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amberx">
            <Loader2 className="h-3 w-3 animate-spin-slow" />
            Processing
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-text-primary sm:text-[28px]">
            Agents are working your request
          </h1>
          <p className="mt-2.5 text-[13px] text-ink-text-secondary max-w-md mx-auto">
            Five agents are collaborating to source, negotiate, and validate your shoot procurement.
          </p>
        </div>

        <div className="w-full space-y-3">
          {STEPS.map((step, i) => {
            const isDone = done[i];
            const isActive = current === i && !isDone;
            const isPending = current < i;
            const Icon = step.icon;
            return (
              <div
                key={i}
                className={cn(
                  'glass card-hover flex items-center gap-4 rounded-xl p-5 transition-all duration-500',
                  isDone ? 'border-greenx/30 glow-green' : isActive ? 'border-amberx/30 glow-amber' : 'border-ink-border opacity-50',
                )}
              >
                <div className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all',
                  isDone ? 'bg-greenx/15' : isActive ? 'bg-amberx/15' : 'bg-ink-raised',
                )}>
                  {isDone ? <Check className="h-5 w-5 text-greenx" />
                    : isActive ? <Loader2 className="h-5 w-5 text-amberx animate-spin-slow" />
                    : <Icon className={cn('h-5 w-5', isPending ? 'text-ink-text-tertiary' : 'text-ink-text-secondary')} />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('text-[13px] font-semibold', isPending ? 'text-ink-text-tertiary' : 'text-ink-text-primary')}>
                      {step.agent}
                    </span>
                    {isActive && <span className="mono text-[10px] text-amberx animate-pulse-dot">WORKING</span>}
                    {isDone && <span className="mono text-[10px] text-greenx font-medium">DONE</span>}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-text-secondary">{step.title}</p>
                </div>
                <div className="mono text-[11px] text-ink-text-tertiary">{String(i + 1).padStart(2, '0')}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-surface">
            <div className="h-full rounded-full bg-amberx transition-all duration-700 ease-out" style={{ width: `${(done.filter(Boolean).length / STEPS.length) * 100}%` }} />
          </div>
          <div className="mono mt-3 text-center text-[10px] text-ink-text-tertiary">
            {done.filter(Boolean).length} / {STEPS.length} agents complete
          </div>
        </div>
      </div>
    </div>
  );
}
