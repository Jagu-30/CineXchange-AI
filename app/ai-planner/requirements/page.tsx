'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import {
  Brain,
  CheckCircle2,
  RotateCw,
  ArrowRight,
  Calendar,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { hour12: false });
  } catch {
    return iso;
  }
}

/** Inclusive day count between two IsoDate strings, or null if either is missing/invalid. */
function shootDays(start: string, end: string): number | null {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000) + 1;
}

function RequirementsPageContent() {
  const { productionId, detail, isLoading, refreshDetail } = useMission();

  useEffect(() => {
    if (productionId) refreshDetail();
  }, [productionId, refreshDetail]);

  const requirements = detail?.requirements ?? [];
  const production = detail?.production ?? null;
  const days = production ? shootDays(production.start_date, production.end_date) : null;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Step 2: decompose (read-only)</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Brain className="h-6 w-6 text-amberx" />
            Requirement Review
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            What the decompose step extracted from the shoot brief. This page is a live view of
            agent output — there is nothing to run or approve here.
          </p>
        </div>

        <button
          onClick={() => refreshDetail()}
          disabled={!productionId || isLoading}
          className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary hover:text-ink-text-primary hover:border-ink-border-strong transition-all disabled:opacity-50"
        >
          <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin-slow')} />
          Refresh
        </button>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Specs" />

      {!productionId ? (
        <div className="glass rounded-2xl p-8 border border-dashed border-ink-border text-center">
          <p className="text-[13px] text-ink-text-secondary">
            No production selected. Submit a brief on the{' '}
            <Link href="/ai-planner" className="text-amberx hover:underline">
              planner hub
            </Link>{' '}
            to start a run.
          </p>
        </div>
      ) : (
        <>
          {/* Project Meta Banner — only real ProductionHeader fields */}
          {production && (
            <div className="glass rounded-2xl p-6 border border-ink-border grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Shoot Brief</div>
                <div className="text-[13px] font-medium text-ink-text-primary mt-1 line-clamp-2">
                  {production.brief_text}
                </div>
              </div>
              <div>
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Budget Cap</div>
                <div className="mono text-[14px] font-semibold text-amberx mt-1">{formatINR(production.budget_cap)}</div>
              </div>
              <div>
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Location
                </div>
                <div className="text-[13px] font-semibold text-greenx mt-1">{production.location}</div>
              </div>
              <div>
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Dates
                </div>
                <div className="mono text-[12.5px] font-semibold text-bluex mt-1">
                  {production.start_date} → {production.end_date}
                  {days != null && <span className="text-ink-text-tertiary"> ({days}d)</span>}
                </div>
              </div>
              <div>
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Status</div>
                <div className="mono text-[13px] font-semibold text-ink-text-primary mt-1">{production.status}</div>
              </div>
            </div>
          )}

          {/* Requirements Table */}
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amberx/15 text-amberx">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-ink-text-primary">
                    Extracted Requirements ({requirements.length})
                  </h2>
                  <p className="text-[11.5px] text-ink-text-secondary">
                    Verbatim decompose output — category, quantity, priority, and free-form spec.
                  </p>
                </div>
              </div>
            </div>

            {requirements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-border p-8 text-center">
                <p className="text-[12.5px] text-ink-text-secondary">
                  No requirements yet. This table populates once the decompose step (step 2) completes.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-ink-border text-[10px] uppercase font-mono tracking-wider text-ink-text-tertiary">
                      <th className="pb-3 pr-4">ID</th>
                      <th className="pb-3 pr-4">Category</th>
                      <th className="pb-3 pr-4 text-center">Qty</th>
                      <th className="pb-3 pr-4 text-center">Priority</th>
                      <th className="pb-3 pr-4">Spec</th>
                      <th className="pb-3 pr-4">Created</th>
                      <th className="pb-3">Sourcing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-border/40 text-[12.5px]">
                    {requirements.map((req) => (
                      <tr key={req.requirement_id} className="hover:bg-ink-raised/40 transition-colors">
                        <td className="py-3.5 pr-4 mono text-[11px] text-ink-text-tertiary">
                          {req.requirement_id.slice(0, 8)}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className="mono text-[10.5px] uppercase px-2 py-0.5 rounded-full bg-ink-surface text-ink-text-secondary border border-ink-border">
                            {req.category}
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-center mono font-bold">{req.quantity}</td>
                        <td className="py-3.5 pr-4 text-center mono text-ink-text-secondary">{req.priority}</td>
                        <td className="py-3.5 pr-4 max-w-sm">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(req.spec || {}).length === 0 ? (
                              <span className="text-[11px] text-ink-text-tertiary">—</span>
                            ) : (
                              Object.entries(req.spec).map(([k, v]) => (
                                <span
                                  key={k}
                                  className="mono text-[9.5px] px-1.5 py-0.5 rounded bg-ink-surface text-ink-text-secondary border border-ink-border/70"
                                >
                                  {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 pr-4 mono text-[11px] text-ink-text-tertiary" suppressHydrationWarning>
                          {formatTimestamp(req.created_at)}
                        </td>
                        <td className="py-3.5">
                          <Link
                            href="/ai-planner/marketplace"
                            className="mono inline-flex items-center gap-1 text-[11px] text-bluex hover:underline"
                          >
                            {req.offers.length} offer(s) <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <AppShell>
      <RequirementsPageContent />
    </AppShell>
  );
}
