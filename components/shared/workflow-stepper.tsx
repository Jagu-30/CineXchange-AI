'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Brain,
  Search,
  Handshake,
  ShieldCheck,
  CheckCircle2,
  Siren,
  FileText,
  Workflow,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const WORKFLOW_STEPS = [
  { href: '/ai-planner', label: '1. Plan Intake', icon: Sparkles, short: 'Intake' },
  { href: '/ai-planner/requirements', label: '2. Requirements', icon: Brain, short: 'Specs' },
  { href: '/ai-planner/marketplace', label: '3. Scout Marketplace', icon: Search, short: 'Scout' },
  { href: '/ai-planner/negotiation', label: '4. Negotiation', icon: Handshake, short: 'Negotiate' },
  { href: '/ai-planner/compliance', label: '5. Compliance & Risk', icon: ShieldCheck, short: 'Compliance' },
  { href: '/ai-planner/booking', label: '6. Booking Record', icon: CheckCircle2, short: 'Booking' },
  { href: '/ai-planner/recovery', label: '7. Emergency Recovery', icon: Siren, short: 'Recovery' },
  { href: '/ai-planner/audit', label: '8. Agent Audit Log', icon: FileText, short: 'Audit' },
];

export function WorkflowStepper({ currentStep }: { currentStep?: string }) {
  const pathname = usePathname();

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center min-w-max gap-2 p-1.5 glass rounded-2xl border border-ink-border">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isActive = pathname === step.href || currentStep === step.short;
          const Icon = step.icon;

          return (
            <Link
              key={step.href}
              href={step.href}
              className={cn(
                'group flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all duration-300',
                isActive
                  ? 'bg-amberx text-ink-bg font-semibold shadow-md shadow-amberx/20'
                  : 'text-ink-text-secondary hover:text-ink-text-primary hover:bg-ink-raised/60',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-ink-bg' : 'text-amberx')} />
              <span className="whitespace-nowrap">{step.label}</span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-ink-bg" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
