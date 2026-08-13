'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Clapperboard, LayoutDashboard, Workflow, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/booking', label: 'Procurement Flow', icon: Workflow },
  { href: '/demo', label: 'Live Recovery Demo', icon: Siren },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-ink-bg">
      <Sidebar />
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-ink-border bg-ink-surface/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-5 h-[68px] border-b border-ink-border">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amberx/10 border border-amberx/30">
                  <Clapperboard className="h-4.5 w-4.5 text-amberx" />
                </div>
                <span className="font-semibold text-sm">CineXchange AI</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-ink-text-secondary hover:text-ink-text-primary transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="p-4 space-y-1.5">
              {NAV.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
                      active
                        ? 'glass text-amberx'
                        : 'text-ink-text-secondary hover:bg-ink-raised/60',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between h-14 px-4 border-b border-ink-border bg-ink-surface/80 backdrop-blur-xl">
          <button onClick={() => setOpen(true)} className="text-ink-text-secondary hover:text-ink-text-primary transition-colors">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-amberx" />
            <span className="text-sm font-semibold">CineXchange AI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-greenx animate-pulse-dot" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
