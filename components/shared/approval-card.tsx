'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatINR, useMission } from '@/lib/mission-context';
import { apiClient, isAgentUnavailableError, isApiError, isConflictError } from '@/lib/api-client';
import type { ApprovalDecisionResponse, ProductionApproval } from '@/lib/types';
import { AlertCircle, AlertTriangle, Check, Clock, Loader2, ShieldCheck, X } from 'lucide-react';

export interface ApprovalCardProps {
  approval: ProductionApproval;
  /** Called after a decision is successfully recorded. */
  onDecided?: (result: ApprovalDecisionResponse) => void;
  className?: string;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { hour12: false });
  } catch {
    return iso;
  }
}

export function ApprovalCard({ approval, onDecided, className = '' }: ApprovalCardProps) {
  const { refreshStatus } = useMission();
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const isRecovery = approval.kind === 'recovery';
  const isPending = approval.producer_decision === 'pending';

  const handleDecide = async (decision: 'approved' | 'rejected') => {
    setDeciding(decision);
    setErrorMessage(null);
    setConflict(false);
    try {
      const result = await apiClient.decideApproval(approval.approval_id, decision);
      await refreshStatus();
      onDecided?.(result);
    } catch (err) {
      if (isConflictError(err)) {
        // Someone else already decided this gate — refreshing is the correct
        // recovery, not retrying the same decision.
        setConflict(true);
        await refreshStatus();
      } else if (isAgentUnavailableError(err)) {
        setErrorMessage('A backend agent could not be reached. You can retry.');
      } else if (isApiError(err)) {
        setErrorMessage(err.detail || err.message);
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Could not record the decision.');
      }
    } finally {
      setDeciding(null);
    }
  };

  if (!isPending) {
    const approved = approval.producer_decision === 'approved';
    return (
      <div className={cn('glass rounded-xl border p-5', approved ? 'border-greenx/30' : 'border-redx/30', className)}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              approved ? 'bg-greenx/15' : 'bg-redx/15',
            )}
          >
            {approved ? <Check className="h-5 w-5 text-greenx" /> : <X className="h-5 w-5 text-redx" />}
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink-text-primary">
              {isRecovery ? 'Recovery approval' : 'Approval gate'} — {approval.producer_decision}
            </div>
            {approval.decided_at && (
              <div className="mono mt-0.5 text-[11px] text-ink-text-tertiary" suppressHydrationWarning>
                Decided {formatTimestamp(approval.decided_at)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'glass-strong rounded-2xl p-6',
        approval.threshold_breached ? 'border-redx/30 glow-alert' : 'border-amberx/30 glow-amber',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            approval.threshold_breached ? 'bg-redx/15' : 'bg-amberx/15',
          )}
        >
          {approval.threshold_breached ? (
            <AlertCircle className="h-5 w-5 text-redx" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-amberx" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[15px] font-semibold text-ink-text-primary">
              {isRecovery ? 'Recovery approval required' : 'Approval required'}
            </h3>
            <span className="mono rounded-full bg-redx/15 px-2.5 py-0.5 text-[10px] font-bold text-redx">
              +{formatINR(approval.delta_amount)}
              {approval.delta_pct != null && ` (${approval.delta_pct.toFixed(1)}%)`}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-text-secondary">{approval.reason}</p>
          {approval.reasons && approval.reasons.length > 0 && (
            <ul className="mt-2 space-y-1">
              {approval.reasons.map((r, idx) => (
                <li key={idx} className="text-[11.5px] text-ink-text-secondary leading-snug">
                  • {r}
                </li>
              ))}
            </ul>
          )}
          <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-text-tertiary">
            <span>Requested by: {approval.requested_by_agent}</span>
            {approval.threshold_pct != null && <span>Threshold: {approval.threshold_pct}%</span>}
            <span className="inline-flex items-center gap-1" suppressHydrationWarning>
              <Clock className="h-3 w-3" />
              {formatTimestamp(approval.created_at)}
            </span>
          </div>
        </div>
      </div>

      {conflict && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amberx/30 bg-amberx/10 p-3 text-[12px] text-amberx">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>This approval was already decided elsewhere. The status has been refreshed.</span>
        </div>
      )}

      {errorMessage && !conflict && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-redx/30 bg-redx/10 p-3 text-[12px] text-redx">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {!conflict && (
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => handleDecide('approved')}
            disabled={deciding !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amberx py-2.5 text-[13px] font-semibold text-ink-bg transition-all duration-300 hover:bg-amberx/90 hover:shadow-lg hover:shadow-amberx/25 disabled:opacity-60"
          >
            {deciding === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </button>
          <button
            onClick={() => handleDecide('rejected')}
            disabled={deciding !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-ink-border py-2.5 text-[13px] font-semibold text-ink-text-primary transition-all duration-300 hover:border-redx/40 hover:text-redx disabled:opacity-60"
          >
            {deciding === 'rejected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
