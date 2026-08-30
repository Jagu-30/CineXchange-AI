'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { ApprovalCard } from '@/components/shared/approval-card';
import { isRecoveryApproval } from '@/lib/types';
import type { ApprovalDecisionResponse, ComplianceCheck, JsonObject, ProductionApproval } from '@/lib/types';
import {
  ShieldCheck,
  ShieldAlert,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  FileCheck,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function evidenceEntries(evidence: JsonObject): [string, unknown][] {
  return Object.entries(evidence || {}).filter(([k]) => k !== 'disclaimer');
}

function CompliancePageContent() {
  const router = useRouter();
  const { productionId, status, detail, pendingApprovalId, productionStatus, refreshDetail, isLoading } =
    useMission();

  const [selectedCheck, setSelectedCheck] = useState<ComplianceCheck | null>(null);

  // Also re-read the record whenever the run's status moves: the producer
  // approves on this page and the pipeline then books in a background task, so
  // the copy fetched on arrival is stale exactly when it matters.
  useEffect(() => {
    if (productionId) void refreshDetail();
  }, [productionId, productionStatus, refreshDetail]);

  const checks: ComplianceCheck[] = detail?.compliance?.checks ?? [];
  const overall = detail?.compliance?.overall ?? null;
  const equipmentValue = detail?.compliance?.equipment_value ?? null;
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  const approvals = detail?.approvals ?? [];
  const complianceApprovals = approvals.filter((a) => !isRecoveryApproval(a));
  const approval: ProductionApproval | null =
    complianceApprovals.find((a) => a.approval_id === pendingApprovalId) ??
    [...complianceApprovals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null;

  // Read both sources, because either can be the fresh one: `detail` is fetched
  // by this page's own effect, while `status` is the provider snapshot (now
  // polled while a run is unfinished). Reading only the provider snapshot — which
  // used to refresh on stream connect and stream end alone, and the stream ends
  // at `awaiting_approval` — kept the only forward button on this page, the one a
  // producer needs immediately after approving, from ever appearing.
  const isBooked = detail?.production.status === 'booked' || status?.status === 'booked';
  const riskUnavailableReason = detail?.unavailable?.risk_assessment ?? null;

  const handleApprovalDecided = (_result: ApprovalDecisionResponse) => {
    void refreshDetail();
  };

  if (!productionId) {
    return (
      <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
        <div className="glass rounded-2xl p-10 text-center border-dashed border-ink-border">
          <ShieldCheck className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
          <div className="text-[14px] font-medium text-ink-text-secondary">No production selected</div>
          <p className="text-[12px] text-ink-text-tertiary mt-1">
            Start or select a production run to see its compliance checks and approval gate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="mono text-[10px] text-ink-text-tertiary">Compliance Agent</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-greenx" />
            Compliance & Approval Center
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Permit, insurance and licensing checks, and the single producer approval gate that guards the pipeline.
          </p>
        </div>

        {isBooked && (
          <button
            onClick={() => router.push('/ai-planner/booking')}
            className="flex items-center gap-2 rounded-xl bg-greenx px-6 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20 transition-all"
          >
            <FileCheck className="h-4 w-4" />
            View Procurement Booking Record
          </button>
        )}
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Compliance" />

      {/* Risk assessment — explicitly unavailable. There is no risk-scoring
          concept anywhere in the backend; render the honest reason instead of
          a fabricated matrix. */}
      <div className="glass rounded-xl p-5 border border-dashed border-ink-border flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-ink-text-tertiary shrink-0 mt-0.5" />
        <div>
          <div className="text-[13px] font-medium text-ink-text-secondary">Risk assessment not available</div>
          <p className="text-[11.5px] text-ink-text-tertiary mt-0.5">
            {riskUnavailableReason ||
              'The backend does not compute a risk score for this production. No risk data exists to display.'}
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left 2 Cols: Compliance Checks & Evidence Viewer */}
        <div className="xl:col-span-2 space-y-6">
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-[16px] font-semibold text-ink-text-primary flex items-center gap-2">
                <FileText className="h-5 w-5 text-amberx" />
                Compliance Checks ({checks.length})
              </h2>
              {checks.length > 0 && (
                <span
                  className={cn(
                    'mono text-[10px] px-2.5 py-1 rounded-full font-bold border',
                    failCount === 0
                      ? 'text-greenx bg-greenx/10 border-greenx/20'
                      : 'text-redx bg-redx/10 border-redx/20',
                  )}
                >
                  {passCount}/{checks.length} Passed
                  {overall && ` · Overall: ${overall.toUpperCase()}`}
                </span>
              )}
            </div>

            {equipmentValue != null && (
              <div className="text-[11.5px] text-ink-text-tertiary">
                Equipment value under check: <span className="text-ink-text-primary font-medium">{formatINR(equipmentValue)}</span>
              </div>
            )}

            {checks.length === 0 ? (
              <div className="glass rounded-xl p-8 text-center border-dashed border-ink-border">
                <FileText className="h-8 w-8 text-ink-text-tertiary mx-auto mb-2 opacity-50" />
                <div className="text-[13px] font-medium text-ink-text-secondary">No compliance checks logged yet</div>
                <p className="text-[11px] text-ink-text-tertiary mt-1">
                  Checks appear here once the compliance step of the pipeline has run.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {checks.map((check) => {
                  const isPass = check.status === 'pass';
                  const isFail = check.status === 'fail';
                  const isSelected = selectedCheck?.check_id === check.check_id;
                  const disclaimer =
                    typeof check.evidence?.disclaimer === 'string' ? check.evidence.disclaimer : null;

                  return (
                    <div
                      key={check.check_id}
                      onClick={() => setSelectedCheck(check)}
                      className={cn(
                        'glass card-hover rounded-xl p-4.5 border transition-all cursor-pointer flex flex-col gap-3',
                        isSelected
                          ? 'border-amberx glow-amber'
                          : isPass
                            ? 'border-greenx/30'
                            : isFail
                              ? 'border-redx/30 bg-redx/5'
                              : 'border-ink-border',
                      )}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3.5">
                          <div
                            className={cn(
                              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                              isPass ? 'bg-greenx/15 text-greenx' : isFail ? 'bg-redx/15 text-redx' : 'bg-ink-surface text-ink-text-tertiary',
                            )}
                          >
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-ink-surface text-ink-text-primary border border-ink-border">
                                {check.check_type}
                              </span>
                              <span className="mono text-[11px] text-ink-text-tertiary">
                                {check.check_id.slice(0, 8)}
                              </span>
                            </div>
                            <div className="mono text-[11px] text-ink-text-tertiary mt-0.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(check.created_at).toLocaleString('en-IN', { hour12: false })}
                            </div>
                          </div>
                        </div>

                        <span
                          className={cn(
                            'mono text-[10px] font-bold uppercase px-2.5 py-1 rounded-full shrink-0 w-fit',
                            isPass
                              ? 'bg-greenx/15 text-greenx'
                              : isFail
                                ? 'bg-redx/15 text-redx'
                                : 'bg-ink-surface text-ink-text-tertiary',
                          )}
                        >
                          {check.status}
                        </span>
                      </div>

                      {disclaimer && (
                        <div className="flex items-center gap-2 rounded-lg bg-amberx/10 border border-amberx/25 px-3 py-2 text-[11px] text-amberx">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{disclaimer}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Check Evidence Inspector */}
          {selectedCheck && (
            <div className="glass rounded-2xl p-6 border border-amberx/30 space-y-3 animate-slide-in">
              <div className="flex items-center justify-between border-b border-ink-border/50 pb-2.5">
                <h3 className="text-[14px] font-semibold text-amberx flex items-center gap-2">
                  <FileCheck className="h-4 w-4" />
                  Evidence · {selectedCheck.check_type} · {selectedCheck.check_id.slice(0, 8)}
                </h3>
              </div>

              {typeof selectedCheck.evidence?.disclaimer === 'string' && (
                <div className="flex items-center gap-2 rounded-lg bg-amberx/10 border border-amberx/25 px-3 py-2 text-[11.5px] text-amberx">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{selectedCheck.evidence.disclaimer as string}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                {evidenceEntries(selectedCheck.evidence).map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-lg bg-ink-surface/70 border border-ink-border">
                    <span className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary block mb-0.5">
                      {k.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-ink-text-primary font-medium">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
                {evidenceEntries(selectedCheck.evidence).length === 0 && (
                  <div className="text-[11.5px] text-ink-text-tertiary">No further evidence fields recorded.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: The real approval gate */}
        <div className="xl:col-span-1 space-y-6">
          {approval ? (
            <ApprovalCard approval={approval} onDecided={handleApprovalDecided} />
          ) : (
            <div className="glass rounded-2xl p-6 border border-ink-border space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink-text-secondary">
                <ShieldCheck className="h-4.5 w-4.5 text-ink-text-tertiary" />
                No approval gate yet
              </div>
              <p className="text-[11.5px] text-ink-text-tertiary">
                {isLoading
                  ? 'Loading production detail…'
                  : 'This production has not reached the approval gate yet, or a producer decision has not been recorded.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompliancePage() {
  return (
    <AppShell>
      <CompliancePageContent />
    </AppShell>
  );
}
