'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { BookingRecord } from '@/lib/types';
import {
  CheckCircle2,
  Calendar,
  ShieldCheck,
  Building,
  AlertTriangle,
  Siren,
  FileCheck,
  ArrowRight,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function BookingPageContent() {
  const router = useRouter();
  const { productionState, triggerIncident, runRecovery } = useMission();
  const [triggering, setTriggering] = useState(false);

  const bookings: BookingRecord[] = productionState?.bookings || [
    {
      booking_id: 'BKG-PROJ001-001',
      resource_id: 'CAM-001',
      resource_name: 'ARRI Alexa Mini LF Package + Prime Lenses',
      vendor_id: 'V001',
      vendor_name: 'LightForge Rentals',
      price: 412000,
      status: 'CONFIRMED',
      delivery_date: '2026-08-20',
      insurance_covered: true,
      created_at: new Date().toISOString(),
    },
    {
      booking_id: 'BKG-PROJ001-002',
      resource_id: 'LGT-001',
      resource_name: 'Weatherproof Astera Titan LED Tube Kit (x12)',
      vendor_id: 'V002',
      vendor_name: 'GlowLab Studio',
      price: 276000,
      status: 'CONFIRMED',
      delivery_date: '2026-08-20',
      insurance_covered: true,
      created_at: new Date().toISOString(),
    },
    {
      booking_id: 'BKG-PROJ001-003',
      resource_id: 'GEN-001',
      resource_name: 'Silent 15kVA Inverter Diesel Generator',
      vendor_id: 'V002',
      vendor_name: 'GlowLab Studio',
      price: 128000,
      status: 'CONFIRMED',
      delivery_date: '2026-08-20',
      insurance_covered: true,
      created_at: new Date().toISOString(),
    },
    {
      booking_id: 'BKG-PROJ001-004',
      resource_id: 'INS-001',
      resource_name: 'Rainforest Shoot All-Risk Insurance Cover',
      vendor_id: 'V003',
      vendor_name: 'ForestFrame / SetGuard',
      price: 78000,
      status: 'CONFIRMED',
      delivery_date: '2026-08-20',
      insurance_covered: true,
      created_at: new Date().toISOString(),
    },
  ];

  const totalCommitted = bookings.reduce((sum, b) => sum + b.price, 0);

  const handleSimulateFailure = async () => {
    setTriggering(true);
    await triggerIncident('CAM-001', 'ARRI Alexa Mini LF reported on-site sensor failure at Agumbe shoot position');
    await runRecovery();
    setTriggering(false);
    router.push('/ai-planner/recovery');
  };

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
            Formal procurement record committed with verified vendors. All equipment lines are insured and dispatch-scheduled.
          </p>
        </div>

        <button
          onClick={handleSimulateFailure}
          disabled={triggering}
          className="flex items-center gap-2 rounded-xl bg-redx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-redx/90 shadow-lg shadow-redx/25 transition-all disabled:opacity-50"
        >
          {triggering ? (
            <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          Simulate Camera Failure (CAM-001)
        </button>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Booking" />

      {/* Overview Banner */}
      <div className="glass-strong rounded-2xl p-6 border border-greenx/30 glow-green flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-greenx/15 text-greenx">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-ink-text-primary">
              All Orders Confirmed & Insured
            </h2>
            <div className="text-[12px] text-ink-text-secondary mt-0.5">
              4 Purchase Orders Committed · 3 Shoot Days (Agumbe Western Ghats)
            </div>
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

        <div className="divide-y divide-ink-border/50">
          {bookings.map((b) => (
            <div key={b.booking_id} className="py-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="mono text-[10px] text-ink-text-tertiary">
                    {b.booking_id} · {b.resource_id}
                  </span>
                  <span
                    className={cn(
                      'mono text-[10px] font-bold px-2 py-0.5 rounded-full',
                      b.status === 'CONFIRMED'
                        ? 'bg-greenx/15 text-greenx'
                        : b.status === 'AT_RISK'
                          ? 'bg-redx/20 text-redx animate-pulse-dot'
                          : 'bg-bluex/15 text-bluex',
                    )}
                  >
                    {b.status}
                  </span>
                </div>
                <div className="text-[14px] font-semibold text-ink-text-primary mt-1">
                  {b.resource_name}
                </div>
                <div className="text-[12px] text-ink-text-secondary mt-0.5">
                  Vendor: <span className="text-ink-text-primary font-medium">{b.vendor_name}</span> · Delivery: {b.delivery_date}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="mono text-[16px] font-bold text-ink-text-primary">{formatINR(b.price)}</div>
                <div className="mono text-[10.5px] text-greenx flex items-center gap-1 justify-end mt-0.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Covered by Policy
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
