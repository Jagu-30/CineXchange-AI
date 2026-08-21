'use client';

import { useMemo } from 'react';
import { useMission, formatINR, formatINRLakh } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { AgentStatusCard } from '@/components/shared/agent-status-card';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { BudgetChart } from '@/components/shared/budget-chart';
import { RequirementsTable } from '@/components/shared/requirements-table';
import { ApprovalCard } from '@/components/shared/approval-card';
import {
  Wallet, TrendingDown, PiggyBank, Activity, ClipboardList, ShieldCheck, Radio,
} from 'lucide-react';

function DashboardContent() {
  const { scenario, agents, activity, requirements, approvals } = useMission();

  const committed = useMemo(
    () => requirements.filter((r) => r.negotiatedPrice != null).reduce((s, r) => s + (r.negotiatedPrice ?? 0), 0),
    [requirements],
  );
  const originalTotal = useMemo(
    () => requirements.filter((r) => r.originalPrice != null).reduce((s, r) => s + (r.originalPrice ?? 0), 0),
    [requirements],
  );
  const savings = originalTotal - committed;
  const remaining = scenario.budgetCap - committed;
  const pendingApproval = approvals.find((a) => !a.resolved);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto">
      {/* Header */}
      <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="h-4 w-4 text-amberx animate-pulse-dot" />
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-amberx font-medium">
              Live · Mission Control
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary">
            {scenario.title}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-text-secondary">{scenario.summary}</p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/ai-planner"
            className="flex items-center gap-2 rounded-xl bg-amberx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all"
          >
            Launch AI Production Planner →
          </a>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <StatCard icon={Wallet} label="Total Budget" value={formatINR(scenario.budgetCap)} sub={`${formatINRLakh(scenario.budgetCap)} ceiling`} accent="amber" />
        <StatCard icon={PiggyBank} label="Committed" value={formatINR(committed)} sub={`${formatINR(remaining)} remaining`} accent="blue" />
        <StatCard icon={TrendingDown} label="Negotiation Savings" value={formatINR(savings)} sub={`${((savings / originalTotal) * 100).toFixed(1)}% off original`} accent="green" />
      </div>

      {/* Agent status row */}
      <section className="mb-8">
        <SectionTitle icon={Activity} title="Agent Status" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {agents.map((agent) => <AgentStatusCard key={agent.id} agent={agent} />)}
        </div>
      </section>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-8">
          {pendingApproval && (
            <section>
              <SectionTitle icon={ShieldCheck} title="Pending Approval" accent="amber" />
              <ApprovalCard approval={pendingApproval} />
            </section>
          )}
          <section>
            <SectionTitle icon={Wallet} title="Budget Commitment" />
            <div className="glass rounded-xl p-6">
              <BudgetChart />
            </div>
          </section>
          <section>
            <SectionTitle icon={ClipboardList} title="Requirements" />
            <div className="glass rounded-xl p-6">
              <RequirementsTable items={requirements} />
            </div>
          </section>
        </div>

        <div className="xl:col-span-1">
          <SectionTitle icon={Activity} title="Live Activity Feed" />
          <div className="xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto pr-1">
            <ActivityFeed events={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: typeof Wallet; label: string; value: string; sub: string; accent: 'amber' | 'blue' | 'green';
}) {
  const accentMap = {
    amber: { text: 'text-amberx', bg: 'bg-amberx/10', border: 'border-amberx/20' },
    blue: { text: 'text-bluex', bg: 'bg-bluex/10', border: 'border-bluex/20' },
    green: { text: 'text-greenx', bg: 'bg-greenx/10', border: 'border-greenx/20' },
  };
  const a = accentMap[accent];
  return (
    <div className={`glass card-hover rounded-xl p-6 border ${a.border} hover:border-ink-border-strong`}>
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-text-tertiary">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.bg}`}>
          <Icon className={`h-4.5 w-4.5 ${a.text}`} />
        </div>
      </div>
      <div className="mono mt-4 text-[24px] font-bold text-ink-text-primary">{value}</div>
      <div className="mono mt-1 text-[11px] text-ink-text-secondary">{sub}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, accent = 'default' }: {
  icon: typeof Activity; title: string; accent?: 'default' | 'amber';
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <Icon className={`h-4 w-4 ${accent === 'amber' ? 'text-amberx' : 'text-ink-text-tertiary'}`} />
      <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">{title}</h2>
      <div className="flex-1 h-px bg-ink-border" />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}
