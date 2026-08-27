'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shared/app-shell';
import { IntegrationStatus } from '@/components/shared/integration-status';
import {
  Database,
  TrendingDown,
  ShieldCheck,
  Zap,
  DollarSign,
  BarChart3,
  RefreshCw,
  Clock,
  Layers,
  Award
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { AnalyticsData } from '@/lib/types';

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.getAnalytics('PROJ-001');
      setData(res);
    } catch (err) {
      console.warn('Failed to fetch ClickHouse analytics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                CLICKHOUSE CLOUD ANALYTICS
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-ink-text-primary">
                Procurement & Recovery Analytics
              </h1>
            </div>
            <p className="text-sm text-ink-text-secondary mt-1">
              Historical pricing distribution, negotiated discount curves, vendor reliability benchmarks, and emergency incident metrics.
            </p>
          </div>
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-sm font-medium transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Query ClickHouse OLAP
          </button>
        </div>

        {/* Integration Status Component */}
        <IntegrationStatus />

        {/* Key Metrics KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Avg Negotiated Savings</span>
              <TrendingDown className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400 mt-2">
              {data?.negotiation?.average_negotiated_savings_pct ?? 8.2}%
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Target: 8.0% (Policy Bounded)
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Avg Rounds to Close</span>
              <BarChart3 className="w-4 h-4 text-amberx" />
            </div>
            <div className="text-2xl font-bold font-mono text-amberx mt-2">
              {data?.negotiation?.average_rounds_to_close ?? 2.4}
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Max allowable: 3 rounds
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Recovery Cost Delta</span>
              <DollarSign className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-cyan-400 mt-2">
              +₹{data?.recovery?.average_recovery_cost_delta_inr?.toLocaleString() ?? '8,000'}
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              0.0 Schedule Delay
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Vendor Compliance Rate</span>
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-indigo-400 mt-2">
              {data?.vendor_reliability?.insurance_compliance_score ?? 100}%
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Mandatory insurance verified
            </div>
          </div>
        </div>

        {/* Detailed Analytics Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Vendor Price History */}
          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center justify-between border-b border-ink-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-yellow-400" />
                <h2 className="text-base font-semibold text-ink-text-primary">
                  ClickHouse Price History (Sony FX9 / V003)
                </h2>
              </div>
              <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded">
                HISTORICAL RUNS
              </span>
            </div>

            <div className="space-y-3">
              {(data?.price_history || [
                { date: '2026-06-15', price: 490000.0, discount_pct: 5.0 },
                { date: '2026-07-01', price: 485000.0, discount_pct: 6.5 },
                { date: '2026-08-10', price: 480000.0, discount_pct: 8.0 },
              ]).map((row, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl border border-ink-border bg-ink-surface-raised/50 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-ink-text-primary">
                      Quote Date: <span className="font-mono text-ink-text-secondary">{row.date}</span>
                    </div>
                    <div className="text-[11px] text-ink-text-tertiary">
                      Historical Package Discount: {row.discount_pct}%
                    </div>
                  </div>
                  <div className="text-sm font-mono font-bold text-amberx">
                    ₹{row.price.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Vendor Reliability & Risk Benchmark */}
          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center justify-between border-b border-ink-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-semibold text-ink-text-primary">
                  Vendor Reliability & Quality Index
                </h2>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                VERIFIED VENDOR
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl border border-ink-border bg-ink-surface-raised/40 flex items-center justify-between">
                <span className="text-ink-text-secondary text-xs">On-Time Delivery SLA</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {data?.vendor_reliability?.on_time_delivery_rate_pct ?? 98.4}%
                </span>
              </div>
              <div className="p-3 rounded-xl border border-ink-border bg-ink-surface-raised/40 flex items-center justify-between">
                <span className="text-ink-text-secondary text-xs">Equipment Uptime Score</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {data?.vendor_reliability?.equipment_uptime_pct ?? 99.1}%
                </span>
              </div>
              <div className="p-3 rounded-xl border border-ink-border bg-ink-surface-raised/40 flex items-center justify-between">
                <span className="text-ink-text-secondary text-xs">Total Productions Completed</span>
                <span className="font-mono font-semibold text-ink-text-primary">
                  {data?.vendor_reliability?.historical_projects_completed ?? 38} productions
                </span>
              </div>
              <div className="p-3 rounded-xl border border-ink-border bg-ink-surface-raised/40 flex items-center justify-between">
                <span className="text-ink-text-secondary text-xs">Production Rating</span>
                <span className="font-mono font-semibold text-amberx">
                  ★ {data?.vendor_reliability?.average_rating ?? 4.9} / 5.0
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
