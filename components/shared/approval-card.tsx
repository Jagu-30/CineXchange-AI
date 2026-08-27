'use client';

import { cn } from '@/lib/utils';
import { formatINR, useMission } from '@/lib/mission-context';
import type { PendingApproval } from '@/lib/types';
import { Star, Clock, Check, Search, AlertCircle, ShieldCheck } from 'lucide-react';

export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { resolveApproval, pushActivity, setAgentStatus } = useMission();

  if (approval.resolved) {
    return (
      <div className="glass glow-green rounded-xl border-greenx/30 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-greenx/15">
            <Check className="h-5 w-5 text-greenx" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink-text-primary">
              {approval.title} — resolved
            </div>
            <div className="mono mt-0.5 text-[11px] text-greenx">
              {approval.resolution === 'selected' && 'Vendor selected'}
              {approval.resolution === 'waitlisted' && 'Waitlisted — agent still searching'}
              {approval.resolution === 'approved' && 'Cost delta approved'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isCostDelta = approval.kind === 'cost_delta';

  const handleSelect = (optionId: string, vendorName: string, price: number) => {
    resolveApproval(approval.id, isCostDelta ? 'approved' : 'selected', optionId);
    if (isCostDelta) {
      setAgentStatus('recovery', 'done');
      setAgentStatus('compliance', 'done');
      pushActivity({
        agent: 'producer',
        agentName: 'Producer Agent',
        message: `Approved recovery cost delta — ${vendorName} confirmed at ${formatINR(price)}.`,
        type: 'success',
      });
    } else {
      setAgentStatus('compliance', 'done');
      setAgentStatus('negotiation', 'done');
      pushActivity({
        agent: 'compliance',
        agentName: 'Compliance & Approval Agent',
        message: `Insurance vendor selected: ${vendorName} at ${formatINR(price)}. Booking record created.`,
        type: 'success',
      });
    }
  };

  const handleWaitlist = () => {
    resolveApproval(approval.id, 'waitlisted');
    setAgentStatus('compliance', 'working');
    pushActivity({
      agent: 'compliance',
      agentName: 'Compliance & Approval Agent',
      message: 'Producer waitlisted current options — resuming vendor search for better quotes.',
      type: 'warning',
    });
  };

  return (
    <div
      className={cn(
        'glass-strong rounded-2xl p-6',
        isCostDelta ? 'border-redx/30 glow-alert' : 'border-amberx/30 glow-amber',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            isCostDelta ? 'bg-redx/15' : 'bg-amberx/15',
          )}
        >
          {isCostDelta ? (
            <AlertCircle className="h-5 w-5 text-redx" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-amberx" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink-text-primary">
              {approval.title}
            </h3>
            {isCostDelta && approval.costDelta != null && (
              <span className="mono rounded-full bg-redx/15 px-2.5 py-0.5 text-[10px] font-bold text-redx">
                +{formatINR(approval.costDelta)}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-text-secondary">
            {approval.context}
          </p>
        </div>
      </div>

      {/* Ranked options */}
      <div className="mt-5 space-y-3">
        {approval.options.map((opt) => (
          <div
            key={opt.id}
            className={cn(
              'glass card-hover rounded-xl p-4',
              opt.recommended ? 'border-amberx/40 glow-amber' : 'border-ink-border',
            )}
          >
            {opt.recommended && (
              <div className="absolute -top-2.5 left-4 rounded-full bg-amberx px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-bg shadow-lg">
                Recommended
              </div>
            )}
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'mono flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold',
                  opt.recommended ? 'bg-amberx/15 text-amberx' : 'bg-ink-surface text-ink-text-tertiary',
                )}
              >
                {opt.rank}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-semibold text-ink-text-primary">
                    {opt.vendorName}
                  </span>
                  <span className="mono text-[16px] font-bold text-ink-text-primary">
                    {formatINR(opt.price)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-text-secondary">
                  {opt.reasoning}
                </p>
                <div className="mt-2.5 flex items-center gap-5">
                  <span className="mono inline-flex items-center gap-1 text-[11px] text-ink-text-tertiary">
                    <Clock className="h-3.5 w-3.5" />
                    {opt.deliveryTime}
                  </span>
                  <span className="mono inline-flex items-center gap-1 text-[11px] text-ink-text-tertiary">
                    <Star className="h-3.5 w-3.5 text-amberx" />
                    {opt.rating.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => handleSelect(opt.id, opt.vendorName, opt.price)}
              className={cn(
                'mt-4 w-full rounded-lg py-2.5 text-[13px] font-semibold transition-all duration-300',
                opt.recommended
                  ? 'bg-amberx text-ink-bg hover:bg-amberx/90 hover:shadow-lg hover:shadow-amberx/25'
                  : 'glass text-ink-text-primary hover:border-ink-border-strong',
              )}
            >
              {isCostDelta ? 'Approve cost delta' : 'Select vendor'}
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleWaitlist}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-border py-2.5 text-[12px] font-medium text-ink-text-secondary transition-all duration-300 hover:border-amberx/40 hover:text-amberx hover:bg-amberx/5"
      >
        <Search className="h-4 w-4" />
        None of these — keep searching (waitlist)
      </button>
    </div>
  );
}
