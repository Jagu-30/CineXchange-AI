'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMission } from '@/lib/mission-context';
import { PIPELINE_STEP_NAMES, TERMINAL_PRODUCTION_STATUSES } from '@/lib/types';
import type { PipelineStepName, StepStreamEvent } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  FileText,
  Layers,
  Search,
  Handshake,
  ListChecks,
  Gavel,
  Calculator,
  ShieldCheck,
  Flag,
  PackageCheck,
  Loader2,
  Check,
  X,
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

// Real backend step names, in the real execution order (PIPELINE_STEP_NAMES).
// No timers, no invented agent names — this is presentation metadata for the
// ten steps the orchestrator itself defines.
const STEP_META: Record<PipelineStepName, { title: string; description: string; icon: LucideIcon }> = {
  ingest: { title: 'Ingest brief', description: 'Reads the shoot brief, budget cap and dates.', icon: FileText },
  decompose: { title: 'Decompose requirements', description: 'Breaks the brief into production requirements.', icon: Layers },
  discover: { title: 'Discover vendors', description: 'Scouts the marketplace for candidate vendors per requirement.', icon: Search },
  solicit: { title: 'Solicit offers', description: 'Requests quotes from discovered vendors.', icon: Handshake },
  shortlist: { title: 'Shortlist offers', description: 'Ranks vendor offers per requirement.', icon: ListChecks },
  negotiate: { title: 'Negotiate', description: 'Negotiates price and terms toward a winning offer.', icon: Gavel },
  total: { title: 'Total cost', description: 'Totals committed cost against the budget cap.', icon: Calculator },
  compliance: { title: 'Compliance checks', description: 'Runs permit, insurance and licensing checks.', icon: ShieldCheck },
  approval_gate: { title: 'Approval gate', description: 'Pauses for producer approval if a threshold is breached.', icon: Flag },
  book: { title: 'Book', description: 'Confirms bookings with winning vendors.', icon: PackageCheck },
};

function eventForStep(stepNumber: number, latestStepByNumber: StepStreamEvent[]): StepStreamEvent | undefined {
  return latestStepByNumber.find((e) => e.step === stepNumber);
}

const STREAM_STATE_LABEL: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: 'Live',
  ended: 'Stream ended',
  error: 'Connection lost',
};

function ProcessingContent() {
  const router = useRouter();
  const { productionId, latestStepByNumber, streamState, streamError, productionStatus } = useMission();

  // Route the moment the run reaches a terminal status — from the live stream's
  // `end` event, or from the status snapshot if the run had already finished
  // before this page mounted. No fake completion, no fixed delay.
  useEffect(() => {
    if (!productionStatus) return;
    if (!(TERMINAL_PRODUCTION_STATUSES as readonly string[]).includes(productionStatus)) return;

    if (productionStatus === 'awaiting_approval') {
      router.replace('/ai-planner/compliance');
    } else if (productionStatus === 'booked') {
      router.replace('/booking');
    } else if (productionStatus === 'failed') {
      router.replace('/ai-planner/audit');
    }
  }, [productionStatus, router]);

  if (!productionId) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-ink-bg">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
        <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <div className="glass rounded-2xl border-dashed border-ink-border p-8">
            <p className="text-[13px] text-ink-text-secondary">
              No production is running. Start one from the intake form.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amberx px-4 py-2 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 transition-all"
            >
              Back to intake
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const doneCount = latestStepByNumber.filter((s) => s.status === 'done').length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-bg">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-80 w-[700px] -translate-x-1/2 rounded-full bg-amberx/8 blur-[140px]" />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mono mb-4 inline-flex items-center gap-2 rounded-full border border-amberx/25 bg-amberx/5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amberx">
            <Loader2 className="h-3 w-3 animate-spin-slow" />
            Processing
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-text-primary sm:text-[28px]">
            Agents are working your request
          </h1>
          <p className="mt-2.5 text-[13px] text-ink-text-secondary max-w-md mx-auto">
            This is the live event stream from the orchestrator — nothing here is simulated.
          </p>
          <div className="mono mt-3 inline-flex items-center gap-1.5 text-[10px] text-ink-text-tertiary">
            {streamState === 'open' ? (
              <Wifi className="h-3 w-3 text-greenx" />
            ) : streamState === 'connecting' ? (
              <Loader2 className="h-3 w-3 animate-spin-slow" />
            ) : (
              <WifiOff className="h-3 w-3 text-redx" />
            )}
            {STREAM_STATE_LABEL[streamState] ?? streamState}
          </div>
        </div>

        {streamError && (
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amberx/30 bg-amberx/10 p-3.5 text-[12px] text-amberx max-w-md">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {streamError.message}
              {streamError.willRetry ? ' — reconnecting automatically.' : ''}
            </span>
          </div>
        )}

        <div className="w-full space-y-3">
          {PIPELINE_STEP_NAMES.map((name, idx) => {
            const stepNumber = idx + 1;
            const meta = STEP_META[name];
            const event = eventForStep(stepNumber, latestStepByNumber);
            const status = event?.status ?? null;
            const isDone = status === 'done';
            const isFailed = status === 'failed';
            const isActive = status === 'in_progress';
            const isPending = status === null;
            const Icon = meta.icon;

            return (
              <div
                key={name}
                className={cn(
                  'glass card-hover flex items-center gap-4 rounded-xl p-5 transition-all duration-500',
                  isDone && 'border-greenx/30 glow-green',
                  isFailed && 'border-redx/40 glow-alert',
                  isActive && 'border-amberx/30 glow-amber',
                  isPending && 'border-ink-border opacity-50',
                )}
              >
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all',
                    isDone && 'bg-greenx/15',
                    isFailed && 'bg-redx/15',
                    isActive && 'bg-amberx/15',
                    isPending && 'bg-ink-raised',
                  )}
                >
                  {isDone ? (
                    <Check className="h-5 w-5 text-greenx" />
                  ) : isFailed ? (
                    <X className="h-5 w-5 text-redx" />
                  ) : isActive ? (
                    <Loader2 className="h-5 w-5 text-amberx animate-spin-slow" />
                  ) : (
                    <Icon className={cn('h-5 w-5', isPending ? 'text-ink-text-tertiary' : 'text-ink-text-secondary')} />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('text-[13px] font-semibold', isPending ? 'text-ink-text-tertiary' : 'text-ink-text-primary')}>
                      {meta.title}
                    </span>
                    {isActive && <span className="mono text-[10px] text-amberx animate-pulse-dot">WORKING</span>}
                    {isDone && <span className="mono text-[10px] text-greenx font-medium">DONE</span>}
                    {isFailed && <span className="mono text-[10px] text-redx font-medium">FAILED</span>}
                    {isPending && (
                      <span className="mono inline-flex items-center gap-1 text-[10px] text-ink-text-tertiary">
                        <Clock className="h-3 w-3" /> PENDING
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-text-secondary">{meta.description}</p>
                </div>
                <div className="mono text-[11px] text-ink-text-tertiary">{String(stepNumber).padStart(2, '0')}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-surface">
            <div
              className="h-full rounded-full bg-amberx transition-all duration-700 ease-out"
              style={{ width: `${(doneCount / PIPELINE_STEP_NAMES.length) * 100}%` }}
            />
          </div>
          <div className="mono mt-3 text-center text-[10px] text-ink-text-tertiary">
            {doneCount} / {PIPELINE_STEP_NAMES.length} steps complete
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  return <ProcessingContent />;
}
