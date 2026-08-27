'use client';

import { cn } from '@/lib/utils';
import { formatINR } from '@/lib/mission-context';
import type { RequirementItem, RequirementStatus } from '@/lib/types';
import { ArrowDown, Minus } from 'lucide-react';

const STATUS_CONFIG: Record<
  RequirementStatus,
  { label: string; cls: string; dot: string }
> = {
  sourcing: { label: 'Sourcing', cls: 'text-bluex bg-bluex/10', dot: 'bg-bluex' },
  negotiating: { label: 'Negotiating', cls: 'text-amberx bg-amberx/10', dot: 'bg-amberx' },
  confirmed: { label: 'Confirmed', cls: 'text-greenx bg-greenx/10', dot: 'bg-greenx' },
  at_risk: { label: 'At Risk', cls: 'text-redx bg-redx/10', dot: 'bg-redx' },
  recovered: { label: 'Recovered', cls: 'text-greenx bg-greenx/10', dot: 'bg-greenx' },
};

export function RequirementsTable({ items }: { items: RequirementItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-ink-border">
            <th className="mono pb-3 pr-4 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Category</th>
            <th className="pb-3 pr-4 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Item</th>
            <th className="pb-3 pr-4 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Vendor</th>
            <th className="mono pb-3 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Original</th>
            <th className="mono pb-3 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Negotiated</th>
            <th className="mono pb-3 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Saved</th>
            <th className="pb-3 text-[10px] font-medium uppercase tracking-wider text-ink-text-tertiary">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const cfg = STATUS_CONFIG[item.status];
            const savings =
              item.originalPrice != null && item.negotiatedPrice != null
                ? item.originalPrice - item.negotiatedPrice
                : null;
            return (
              <tr
                key={item.id}
                className="border-b border-ink-border/40 transition-colors hover:bg-ink-raised/40"
              >
                <td className="py-3.5 pr-4">
                  <span className="mono text-[11px] font-medium text-ink-text-primary">{item.category}</span>
                </td>
                <td className="py-3.5 pr-4 max-w-[240px]">
                  <span className="text-[12px] text-ink-text-secondary leading-snug">{item.itemName}</span>
                </td>
                <td className="py-3.5 pr-4">
                  <span className="text-[12px] text-ink-text-secondary">{item.vendor ?? '—'}</span>
                </td>
                <td className="mono py-3.5 pr-4 text-right text-[12px] text-ink-text-tertiary line-through decoration-ink-border">
                  {formatINR(item.originalPrice)}
                </td>
                <td className="mono py-3.5 pr-4 text-right text-[12px] font-medium text-ink-text-primary">
                  {formatINR(item.negotiatedPrice)}
                </td>
                <td className="py-3.5 pr-4 text-right">
                  {savings != null && savings > 0 ? (
                    <span className="mono inline-flex items-center gap-0.5 text-[11px] font-semibold text-greenx">
                      <ArrowDown className="h-3 w-3" />
                      {formatINR(savings)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-ink-text-tertiary">
                      <Minus className="h-3 w-3" />
                    </span>
                  )}
                </td>
                <td className="py-3.5">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold', cfg.cls)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                    {cfg.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
