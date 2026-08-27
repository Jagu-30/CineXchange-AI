'use client';

import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityType } from '@/lib/types';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

const TYPE_CONFIG: Record<
  ActivityType,
  { icon: LucideIcon; color: string; bg: string; border: string }
> = {
  info: { icon: Info, color: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/20' },
  success: { icon: CheckCircle2, color: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/20' },
  warning: { icon: AlertTriangle, color: 'text-redx', bg: 'bg-redx/10', border: 'border-redx/20' },
  approval: { icon: ShieldCheck, color: 'text-amberx', bg: 'bg-amberx/10', border: 'border-amberx/20' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="flex flex-col gap-2">
      {events.map((ev, i) => {
        const cfg = TYPE_CONFIG[ev.type];
        const Icon = cfg.icon;
        const isNew = i === 0;
        return (
          <div
            key={ev.id}
            className={cn(
              'glass card-hover rounded-xl p-4 hover:border-ink-border-strong',
              cfg.border,
              isNew && 'animate-slide-in',
            )}
          >
            <div className="flex gap-3">
              <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', cfg.bg)}>
                <Icon className={cn('h-4 w-4', cfg.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-ink-text-primary">
                    {ev.agentName}
                  </span>
                  <span className="mono text-[10px] text-ink-text-tertiary" suppressHydrationWarning>
                    {formatTime(ev.timestamp)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-text-secondary">
                  {ev.message}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
