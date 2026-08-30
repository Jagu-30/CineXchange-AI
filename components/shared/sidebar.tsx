'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clapperboard,
  LayoutDashboard,
  Sparkles,
  Workflow,
  Siren,
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Activity,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatINR, useMission } from '@/lib/mission-context';
import { DemoBadge } from './demo-badge';

const MAIN_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Mission control overview' },
  { href: '/ai-planner', label: 'AI Production Planner', icon: Sparkles, desc: 'End-to-end multi-agent planner' },
];

const PLANNER_SUBNAV = [
  { href: '/ai-planner/requirements', label: 'Requirements', icon: Brain },
  { href: '/ai-planner/marketplace', label: 'Marketplace Scout', icon: Search },
  { href: '/ai-planner/negotiation', label: 'Negotiation Agent', icon: Handshake },
  { href: '/ai-planner/compliance', label: 'Compliance & Risk', icon: ShieldCheck },
  { href: '/ai-planner/booking', label: 'Booking Record', icon: CheckCircle2 },
  { href: '/ai-planner/monitoring', label: 'Grafana Monitoring', icon: Activity },
  { href: '/ai-planner/recovery', label: 'Emergency Recovery', icon: Siren },
  { href: '/ai-planner/analytics', label: 'ClickHouse Analytics', icon: BarChart3 },
  { href: '/ai-planner/audit', label: 'Agent Audit Log', icon: FileText },
];

const SECONDARY_NAV = [
  { href: '/booking', label: 'Pipeline Architecture', icon: Workflow, desc: '10-step agent pipeline guide' },
  { href: '/demo', label: 'Simulated Recovery', icon: Siren, desc: 'Interactive failure simulation' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { productionId, status } = useMission();

  return (
    <aside className="hidden lg:flex w-[272px] shrink-0 flex-col border-r border-ink-border bg-ink-surface/85 backdrop-blur-xl">
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
            Autonomous Procurement
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        <div>
          <div className="mono mb-2.5 px-2 text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
            Mission Control
          </div>
          <ul className="space-y-1">
            {MAIN_NAV.map((item) => {
              const active = pathname === item.href || (item.href === '/ai-planner' && pathname.startsWith('/ai-planner'));
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-300',
                      active
                        ? 'glass text-amberx border-amberx/25 shadow-lg shadow-black/20'
                        : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/60 border border-transparent',
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amberx" />
                    )}
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                        active ? 'bg-amberx/15' : 'bg-ink-raised group-hover:bg-ink-border',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-amberx')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-tight">{item.label}</div>
                    </div>
                    {active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amberx animate-pulse-dot" />
                    )}
                  </Link>

                  {/* Sub-nav for AI Planner */}
                  {item.href === '/ai-planner' && pathname.startsWith('/ai-planner') && (
                    <ul className="mt-1.5 ml-5 pl-2.5 border-l border-ink-border space-y-1">
                      {PLANNER_SUBNAV.map((sub) => {
                        const isSubActive = pathname === sub.href;
                        const SubIcon = sub.icon;
                        return (
                          <li key={sub.href}>
                            <Link
                              href={sub.href}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px] transition-all',
                                isSubActive
                                  ? 'bg-amberx/15 text-amberx font-semibold'
                                  : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/40',
                              )}
                            >
                              <SubIcon className="h-3 w-3 shrink-0" />
                              <span>{sub.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <div className="mono mb-2.5 px-2 text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
            System References
          </div>
          <ul className="space-y-1">
            {SECONDARY_NAV.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-[12.5px] transition-all',
                      active
                        ? 'glass text-amberx border-amberx/25'
                        : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/50',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-ink-text-tertiary" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Active Mission Card */}
        <div className="px-2">
          <div className="mono mb-2 text-[9px] uppercase tracking-[0.2em] text-ink-text-tertiary">
            Active Production
          </div>
          {productionId && status ? (
            <div className="glass rounded-xl p-3.5 border border-ink-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="mono text-[9px] uppercase tracking-wider text-amberx font-semibold">
                  {status.status}
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-amberx animate-pulse-dot" />
              </div>
              <div className="mono text-[11.5px] font-medium leading-snug text-ink-text-primary truncate">
                {productionId}
              </div>
              <div className="mono mt-1 text-[11px] text-ink-text-tertiary">
                {status.total_cost != null
                  ? `${formatINR(status.total_cost)} of ${formatINR(status.budget_cap)} cap`
                  : `${formatINR(status.budget_cap)} cap`}
                {' · Step '}
                {status.current_step}/10
              </div>
            </div>
          ) : (
            <div className="glass rounded-xl p-3.5 border border-dashed border-ink-border">
              <div className="text-[11.5px] text-ink-text-tertiary">No active production selected.</div>
            </div>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-ink-border px-5 py-4 bg-ink-surface/50">
        <DemoBadge />
        <div className="mono mt-2 text-[9px] text-ink-text-tertiary">
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
}
