'use client';

import { Sparkles, ShieldCheck } from 'lucide-react';

export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <div
      className={`glass inline-flex items-center gap-2 rounded-full border border-amberx/30 bg-amberx/10 px-3 py-1 text-[11px] font-medium text-amberx ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amberx animate-pulse-dot" />
      <span className="mono uppercase tracking-wider">Demo Mode · Simulated Data</span>
    </div>
  );
}

export function SystemStatusPill() {
  return (
    <div className="glass flex items-center gap-2 rounded-full border border-greenx/25 bg-greenx/10 px-3 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-greenx animate-pulse-dot" />
      <span className="mono text-[10px] font-medium text-greenx tracking-wider">SYSTEM ONLINE</span>
    </div>
  );
}
