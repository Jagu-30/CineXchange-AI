'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useMission, formatINR, parseMoney } from '@/lib/mission-context';
import { isApiError } from '@/lib/api-client';
import { AppShell } from '@/components/shared/app-shell';
import {
  CheckCircle2,
  ShieldCheck,
  Package,
  Loader2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// This is where the processing page routes once a run's terminal status is
// `booked` — the honest landing view of what the agents actually confirmed,
// read live from GET /productions/{id}. It used to describe a fictional
// 5-agent, 10-step pipeline that didn't match this backend's real step names
// or its recovery model; that content is gone, not relocated.

function BookingLandingContent() {
  const { productionId, detail, isLoading, error, clearError, refreshDetail } = useMission();

  useEffect(() => {
    if (productionId) refreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId]);

  const bookings = detail?.bookings ?? [];
  // A recovery does not delete the booking it replaces: the old row stays
  // `superseded` and the replacement is `confirmed`, so both sit in
  // `detail.bookings`. Summing every row double-counts every recovery. Only
  // confirmed rows are committed money — the same filter the dashboard uses.
  const confirmedBookings = bookings.filter((b) => b.status === 'confirmed');
  const supersededCount = bookings.length - confirmedBookings.length;
  const totalCommitted = confirmedBookings.reduce(
    (sum, b) => sum + (parseMoney(b.final_price) ?? 0),
    0,
  );

  const insuranceCheck = detail?.compliance.checks.find((c) => c.check_type === 'insurance') ?? null;

  const errorMessage = error ? (isApiError(error) ? error.detail || error.message : error.message) : null;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1100px] mx-auto space-y-8">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-greenx font-medium">
            Procurement Complete
          </span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary flex items-center gap-2.5">
          <CheckCircle2 className="h-6 w-6 text-greenx" />
          Bookings Confirmed
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-text-secondary max-w-2xl">
          Every line below is a real booking row from step 10 (<span className="mono">book</span>) of this
          production — nothing on this page is scripted.
        </p>
      </header>

      {/* `error` is the shared context error — any failed request anywhere in
          the app sets it and nothing clears it on navigation. Show it beside the
          record with a dismiss control; blanking the page over an unrelated
          failure elsewhere loses the only view of what was actually booked. */}
      {errorMessage && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-redx/30 bg-redx/10 p-4 text-[13px] text-redx">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={clearError} className="shrink-0 hover:text-redx/70" aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!productionId ? (
        <div className="glass rounded-2xl border-dashed border-ink-border p-10 text-center">
          <HelpCircle className="h-8 w-8 text-ink-text-tertiary mx-auto mb-3 opacity-60" />
          <p className="text-[13px] text-ink-text-secondary">No production selected yet.</p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amberx px-4 py-2 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 transition-all"
          >
            Start a production
          </Link>
        </div>
      ) : !detail ? (
        <div className="glass rounded-2xl p-10 text-center">
          {isLoading ? (
            <>
              <Loader2 className="h-6 w-6 text-amberx animate-spin-slow mx-auto mb-3" />
              <p className="text-[13px] text-ink-text-secondary">Loading production record…</p>
            </>
          ) : (
            <p className="text-[13px] text-ink-text-secondary">
              The production record could not be loaded, so there is nothing to show yet.
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            className={cn(
              'glass-strong rounded-2xl p-6 border flex flex-col md:flex-row items-start md:items-center justify-between gap-4',
              confirmedBookings.length > 0 ? 'border-greenx/30 glow-green' : 'border-ink-border',
            )}
          >
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-xl',
                  confirmedBookings.length > 0
                    ? 'bg-greenx/15 text-greenx'
                    : 'bg-ink-raised text-ink-text-tertiary',
                )}
              >
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-ink-text-primary">
                  {confirmedBookings.length} booking{confirmedBookings.length === 1 ? '' : 's'} committed
                </h2>
                <div className="text-[12px] text-ink-text-secondary mt-0.5">
                  {detail.production.location} · {detail.production.start_date} – {detail.production.end_date}
                </div>
                {supersededCount > 0 && (
                  <div className="mono mt-1 text-[10.5px] text-ink-text-tertiary">
                    {supersededCount} superseded booking{supersededCount === 1 ? '' : 's'} excluded from the
                    total — replaced by a recovery.
                  </div>
                )}
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

          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-4">
            <h3 className="text-[15px] font-semibold text-ink-text-primary flex items-center gap-2">
              <Package className="h-4.5 w-4.5 text-amberx" />
              Committed Line Items
            </h3>

            {bookings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-border p-8 text-center">
                <p className="text-[12.5px] text-ink-text-tertiary">
                  No bookings recorded for this production yet.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ink-border/50">
                {bookings.map((b) => (
                  <div key={b.booking_id} className="py-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[10px] text-ink-text-tertiary">{b.booking_id.slice(0, 8)}</span>
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

          <Link
            href="/ai-planner/booking"
            className="inline-flex items-center gap-2 text-[12.5px] font-medium text-amberx hover:text-amberx/80 transition-colors"
          >
            View the full booking record <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </div>
  );
}

export default function BookingPage() {
  return (
    <AppShell>
      <BookingLandingContent />
    </AppShell>
  );
}
