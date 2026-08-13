'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clapperboard, LayoutDashboard, Workflow, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMission } from '@/lib/mission-context';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Mission control overview' },
  { href: '/booking', label: 'Procurement Flow', icon: Workflow, desc: '10-step agent pipeline' },
  { href: '/demo', label: 'Live Recovery Demo', icon: Siren, desc: 'Simulate equipment failure' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { scenario } = useMission();

  return (
    <aside className="hidden lg:flex w-[264px] shrink-0 flex-col border-r border-ink-border bg-ink-surface/80 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-[68px] border-b border-ink-border">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amberx/20 to-amberx/5 border border-amberx/30">
          <Clapperboard className="h-5 w-5 text-amberx" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amberx animate-pulse-dot ring-2 ring-ink-surface" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-ink-text-primary">
            CineXchange <span className="text-amberx">AI</span>
          </div>
          <div className="mono text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
            Procurement Control
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-6">
        <div className="mono mb-3 px-2 text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
          Navigation
        </div>
        <ul className="space-y-1.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-300',
                    active
                      ? 'glass text-amberx border-amberx/25'
                      : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/60 border border-transparent',
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amberx" />
                  )}
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                    active ? 'bg-amberx/15' : 'bg-ink-raised group-hover:bg-ink-border',
                  )}>
                    <Icon className={cn('h-4 w-4 shrink-0', active && 'text-amberx')} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-tight">{item.label}</div>
                    <div className="text-[10px] text-ink-text-tertiary leading-tight mt-0.5">{item.desc}</div>
                  </div>
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amberx animate-pulse-dot" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Mission card */}
        <div className="mt-8 px-2">
          <div className="mono mb-2 text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
            Active Mission
          </div>
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amberx animate-pulse-dot" />
              <span className="mono text-[9px] uppercase tracking-wider text-amberx">In Progress</span>
            </div>
            <div className="text-[13px] font-medium leading-snug text-ink-text-primary">
              {scenario.title}
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-ink-text-secondary">
              {scenario.summary}
            </div>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-ink-border px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="mono text-[9px] uppercase tracking-[0.14em] text-ink-text-tertiary">
            System
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-greenx animate-pulse-dot" />
            <span className="mono text-[9px] text-greenx font-medium">ONLINE</span>
          </div>
        </div>
        <div className="mono mt-2 text-[9px] text-ink-text-tertiary">
          v0.9.4-mvp · mock data
        </div>
      </div>
    </aside>
  );
}
