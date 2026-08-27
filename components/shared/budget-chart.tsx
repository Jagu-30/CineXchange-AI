'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BUDGET_SNAPSHOTS } from '@/lib/mockData';
import { formatINRLakh } from '@/lib/mission-context';

export function BudgetChart() {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={BUDGET_SNAPSHOTS} margin={{ top: 16, right: 16, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="committedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E3A748" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#E3A748" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="remainingGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5B8DBF" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#5B8DBF" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1E242E" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#5B6470"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tick={{ fontFamily: 'var(--font-mono)' }}
            dy={8}
          />
          <YAxis
            stroke="#5B6470"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tick={{ fontFamily: 'var(--font-mono)' }}
            tickFormatter={(v) => '₹' + v / 100000 + 'L'}
            width={56}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(14, 17, 23, 0.92)',
              backdropFilter: 'blur(16px)',
              border: '1px solid #2A3240',
              borderRadius: '10px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              boxShadow: '0 12px 40px -12px rgba(0,0,0,0.6)',
            }}
            labelStyle={{ color: '#8B939F', marginBottom: '6px' }}
            itemStyle={{ color: '#E8EAED' }}
            formatter={(value: number, name: string) => [
              formatINRLakh(value),
              name === 'committed' ? 'Committed' : 'Remaining',
            ]}
          />
          <Area
            type="monotone"
            dataKey="remaining"
            stroke="#5B8DBF"
            strokeWidth={1.5}
            strokeOpacity={0.5}
            fill="url(#remainingGrad)"
          />
          <Area
            type="monotone"
            dataKey="committed"
            stroke="#E3A748"
            strokeWidth={2.5}
            fill="url(#committedGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
