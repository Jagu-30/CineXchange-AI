'use client';

import { cn } from '@/lib/utils';
import type { Agent, AgentStatus } from '@/lib/types';
import {
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  Siren,
  Cpu,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<Agent['id'], LucideIcon> = {
  producer: Brain,
  scout: Search,
  negotiation: Handshake,
  compliance: ShieldCheck,
  recovery: Siren,
  policy_engine: Cpu,
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; dot: string; text: string; bg: string; border: string; glow: string; pulse: boolean }
> = {
  idle: {
    label: 'Idle',
    dot: 'bg-ink-text-tertiary',
    text: 'text-ink-text-tertiary',
    bg: 'bg-ink-text-tertiary/5',
    border: 'border-ink-border',
    glow: '',
    pulse: false,
  },
  working: {
    label: 'Working',
    dot: 'bg-bluex',
    text: 'text-bluex',
    bg: 'bg-bluex/10',
    border: 'border-bluex/25',
    glow: 'shadow-[0_0_24px_-8px_rgba(91,141,191,0.4)]',
    pulse: true,
  },
  waiting_approval: {
    label: 'Waiting · Approval',
    dot: 'bg-amberx',
    text: 'text-amberx',
    bg: 'bg-amberx/10',
    border: 'border-amberx/25',
    glow: 'shadow-[0_0_24px_-8px_rgba(227,167,72,0.4)]',
    pulse: true,
  },
  done: {
    label: 'Done',
    dot: 'bg-greenx',
    text: 'text-greenx',
    bg: 'bg-greenx/10',
    border: 'border-greenx/25',
    glow: '',
    pulse: false,
  },
  alert: {
    label: 'Alert',
    dot: 'bg-redx',
    text: 'text-redx',
    bg: 'bg-redx/10',
    border: 'border-redx/30',
    glow: 'shadow-[0_0_28px_-6px_rgba(217,101,79,0.5)]',
    pulse: true,
  },
  blocked: {
    label: 'Blocked',
    dot: 'bg-redx',
    text: 'text-redx',
    bg: 'bg-redx/10',
    border: 'border-redx/30',
    glow: '',
    pulse: false,
  },
};

export function AgentStatusCard({ agent }: { agent: Agent }) {
  const cfg = STATUS_CONFIG[agent.status];
  const Icon = ICONS[agent.id];

  return (
    <div
      className={cn(
        'glass card-hover rounded-xl p-5 hover:border-ink-border-strong',
        cfg.border,
        cfg.glow,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', cfg.bg)}>
          <Icon className={cn('h-5 w-5', cfg.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight text-ink-text-primary">
            {agent.name}
          </div>
          <div className="mono mt-0.5 text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary">
            {agent.role}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-text-secondary">
        {agent.description}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
            cfg.bg,
            cfg.text,
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, cfg.pulse && 'animate-pulse-dot')}
          />
          {cfg.label}
        </span>
      </div>
    </div>
  );
}
