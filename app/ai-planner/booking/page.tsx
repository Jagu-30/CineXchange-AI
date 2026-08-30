'use client';

import { useEffect } from 'react';
import { useMission, formatINR } from '@/lib/mission-context';
import { isApiError } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import {
  CheckCircle2,
  ShieldCheck,
  FileCheck,
  Package,
  Loader2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function BookingPageContent() {
  const { productionId, detail, isLoading, error, refreshDetail } = useMission();

  useEffect(() => {
    if (productionId) refreshDetail();
    // Only re-fetch when the selected production changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId]);

  const bookings = detail?.bookings ?? [];
  const totalCommitted = bookings.reduce((sum, b) => {
    const n = Number(b.final_price);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  // The backend has no per-booking "insurance covered" flag — insurance is a
  // production-level compliance check (check_type === 'insurance'), not a
  // property of a booking row. Render that real check, honestly, instead of a
  // per-line badge the API never sends.
  const insuranceCheck = detail?.compliance.checks.find((c) => c.check_type === 'insurance') ?? null;

  const errorMessage = error ? (isApiError(error) ? error.detail || error.message : error.message) : null;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Procurement Booking Records</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <FileCheck className="h-6 w-6 text-greenx" />
            Confirmed Booking & Procurement Record
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Read-only record of step 10 (<span className="mono">book</span>) — the vendors the agents actually
            confirmed, sourced live from the production.
          </p>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Booking" />

      {!productionId ? (
        <div className="glass rounded-2xl border-dashed border-ink-border p-10 text-center">
          <HelpCircle className="h-8 w-8 text-ink-text-tertiary mx-auto mb-3 opacity-60" />
          <p className="text-[13px] text-ink-text-secondary">No production selected yet.</p>
          <p className="mt-1 text-[12px] text-ink-text-tertiary">Start one from the intake form to see booking records here.</p>
        </div>
      ) : isLoading && !detail ? (
        <div className="glass rounded-2xl p-10 text-center">
          <Loader2 className="h-6 w-6 text-amberx animate-spin-slow mx-auto mb-3" />
          <p className="text-[13px] text-ink-text-secondary">Loading production record…</p>
        </div>
      ) : errorMessage ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-redx/30 bg-redx/10 p-4 text-[13px] text-redx">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      ) : (
        <>
          {/* Overview Banner */}
          <div
            className={cn(
              'glass-strong rounded-2xl p-6 border flex flex-col md:flex-row items-start md:items-center justify-between gap-4',
              bookings.length > 0 ? 'border-greenx/30 glow-green' : 'border-ink-border',
            )}
          >
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-xl',
                  bookings.length > 0 ? 'bg-greenx/15 text-greenx' : 'bg-ink-raised text-ink-text-tertiary',
                )}
              >
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-ink-text-primary">
                  {bookings.length > 0 ? 'Orders Confirmed' : 'No bookings yet'}
                </h2>
                <div className="text-[12px] text-ink-text-secondary mt-0.5">
                  {bookings.length} booking{bookings.length === 1 ? '' : 's'} committed
                  {detail && ` · ${detail.production.location} · ${detail.production.start_date} – ${detail.production.end_date}`}
                </div>
                {insuranceCheck && (
                  <div className="mono mt-1.5 inline-flex items-center gap-1.5 text-[10.5px] text-ink-text-secondary">
                    <ShieldCheck className={cn('h-3.5 w-3.5', insuranceCheck.status === 'pass' ? 'text-greenx' : 'text-amberx')} />
                    Insurance check: {insuranceCheck.status}
                  </div>
                )}
              </div>
            </div>

            <div className="mono text-right">
              <div className="text-[10.5px] uppercase text-ink-text-tertiary">Total Committed Spend</div>
              <div className="text-[24px] font-bold text-amberx">{formatINR(totalCommitted)}</div>
            </div>
          </div>

          {/* Booking Items List */}
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-4">
            <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Package className="h-4.5 w-4.5 text-amberx" />
              Committed Line Items
            </h3>

            {bookings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-border p-8 text-center">
                <p className="text-[12.5px] text-ink-text-tertiary">
                  No bookings recorded for this production yet. They appear here once step 10 (book) has run.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ink-border/50">
                {bookings.map((b) => (
                  <div key={b.booking_id} className="py-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[10px] text-ink-text-tertiary">
                          {b.booking_id.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            'mono text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                            b.status === 'confirmed' ? 'bg-greenx/15 text-greenx' : 'bg-ink-surface text-ink-text-tertiary',
                          )}
                        >
                          {b.status}
                        </span>
                        {b.vendor_category && (
                          <span className="mono text-[10px] text-ink-text-tertiary">{b.vendor_category}</span>
                        )}
                      </div>
                      <div className="text-[14px] font-semibold text-ink-text-primary mt-1">
                        {b.vendor_name ?? 'Unnamed vendor'}
                      </div>
                      <div className="text-[12px] text-ink-text-secondary mt-0.5">
                        {b.booked_at ? `Booked: ${b.booked_at}` : 'Booked date not recorded'}
                        {b.vendor_rating_current != null && ` · Rating: ${b.vendor_rating_current}`}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="mono text-[16px] font-bold text-ink-text-primary">{formatINR(b.final_price)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function BookingPage() {
  return (
    <AppShell>
      <BookingPageContent />
    </AppShell>
  );
}
