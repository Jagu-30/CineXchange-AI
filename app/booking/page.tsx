'use client';

import { useMission } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { PROCUREMENT_STEPS } from '@/lib/mockData';
import type { AgentId } from '@/lib/types';
import {
  Brain, Search, Handshake, ShieldCheck, Siren, Cpu, Check, type LucideIcon,
} from 'lucide-react';

const ICONS: Record<AgentId, LucideIcon> = {
  producer: Brain, scout: Search, negotiation: Handshake, compliance: ShieldCheck, recovery: Siren, policy_engine: Cpu,
};

const AGENT_COLOR: Record<AgentId, string> = {
  producer: 'text-amberx', scout: 'text-bluex', negotiation: 'text-amberx', compliance: 'text-greenx', recovery: 'text-redx', policy_engine: 'text-purple-400',
};

const AGENT_BG: Record<AgentId, string> = {
  producer: 'bg-amberx/10', scout: 'bg-bluex/10', negotiation: 'bg-amberx/10', compliance: 'bg-greenx/10', recovery: 'bg-redx/10', policy_engine: 'bg-purple-500/10',
};


function BookingContent() {
  const { scenario } = useMission();

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1100px] mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-amberx font-medium">
            Procurement Workflow
          </span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary">
          10-Step Procurement Pipeline
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-text-secondary max-w-2xl">
          How the 5 agents collaborate to take your shoot brief from request to delivered
          procurement — with automatic recovery.
        </p>
      </header>

      {/* Agent legend */}
      <div className="mb-8 flex flex-wrap gap-2.5">
        {(Object.keys(ICONS) as AgentId[]).map((id) => {
          const Icon = ICONS[id];
          const name = PROCUREMENT_STEPS.find((s) => s.agent === id)?.agentName ?? id;
          return (
            <div key={id} className="glass card-hover flex items-center gap-2 rounded-full px-3.5 py-1.5 hover:border-ink-border-strong">
              <Icon className={`h-3.5 w-3.5 ${AGENT_COLOR[id]}`} />
              <span className="text-[11px] font-medium text-ink-text-secondary">{name}</span>
            </div>
          );
        })}
      </div>

      {/* Steps */}
      <div className="relative">
        <div className="absolute left-[23px] top-5 bottom-5 w-px bg-gradient-to-b from-ink-border via-ink-border to-transparent" />
        <div className="space-y-4">
          {PROCUREMENT_STEPS.map((step, i) => {
            const Icon = ICONS[step.agent];
            const isLast = i === PROCUREMENT_STEPS.length - 1;
            return (
              <div key={step.step} className="relative flex gap-5 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="relative z-10 flex flex-col items-center">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink-bg ${AGENT_BG[step.agent]} shadow-lg`}>
                    <Icon className={`h-5 w-5 ${AGENT_COLOR[step.agent]}`} />
                  </div>
                  {!isLast && <div className="mono mt-1.5 text-[9px] text-ink-text-tertiary">{String(step.step).padStart(2, '0')}</div>}
                </div>
                <div className="flex-1 pb-2">
                  <div className="glass card-hover rounded-xl p-5 hover:border-ink-border-strong">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="mono flex h-7 w-7 items-center justify-center rounded-lg bg-ink-surface text-[12px] font-bold text-ink-text-primary">
                          {step.step}
                        </span>
                        <h3 className="text-[14px] font-semibold text-ink-text-primary">{step.title}</h3>
                      </div>
                      <span className={`mono text-[10px] font-medium ${AGENT_COLOR[step.agent]}`}>{step.agentName}</span>
                    </div>
                    <p className="mt-2.5 text-[12px] leading-relaxed text-ink-text-secondary">{step.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-10 glass rounded-xl p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-greenx/15">
            <Check className="h-4 w-4 text-greenx" />
          </div>
          <span className="text-[13px] font-semibold text-ink-text-primary">
            End-to-end autonomous procurement
          </span>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-text-secondary max-w-2xl">
          From the moment a producer submits a shoot brief, the pipeline runs without manual
          intervention — except where producer approval is required. The Emergency Recovery
          Agent stays on standby throughout the shoot, ready to re-source and re-negotiate if
          anything fails on-site.
        </p>
      </div>
    </div>
  );
}

export default function BookingPage() {
  return (
    <AppShell>
      <BookingContent />
    </AppShell>
  );
}
