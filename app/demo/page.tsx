'use client';

import { useRef, useState } from 'react';
import { MissionProvider, useMission } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { ApprovalCard } from '@/components/shared/approval-card';
import { RECOVERY_SCRIPT, RECOVERY_COST_DELTA_APPROVAL } from '@/lib/mockData';
import { Siren, Play, RotateCcw, Activity, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

function DemoContent() {
  const { activity, pushActivity, setAgentStatus, addApproval, approvals } = useMission();
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const runSequence = () => {
    if (running) return;
    setRunning(true);
    setCompleted(false);
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    setAgentStatus('recovery', 'alert');

    RECOVERY_SCRIPT.forEach((msg, i) => {
      const delay = i * 1200 + 600;
      timeouts.push(setTimeout(() => {
        pushActivity(msg);
        if (i === 0) setAgentStatus('recovery', 'alert');
        if (i === 2) setAgentStatus('scout', 'working');
        if (i === 4) setAgentStatus('negotiation', 'working');
        if (i === 5) setAgentStatus('scout', 'done');
        if (i === 6) { setAgentStatus('negotiation', 'done'); setAgentStatus('recovery', 'working'); }
      }, delay));
    });

    const finalDelay = RECOVERY_SCRIPT.length * 1200 + 600 + 800;
    timeouts.push(setTimeout(() => {
      setAgentStatus('compliance', 'waiting_approval');
      setAgentStatus('recovery', 'waiting_approval');
      addApproval({ ...RECOVERY_COST_DELTA_APPROVAL });
      setRunning(false);
      setCompleted(true);
    }, finalDelay));
    timeoutsRef.current = timeouts;
  };

  const reset = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setRunning(false);
    setCompleted(false);
    setAgentStatus('recovery', 'idle');
    setAgentStatus('compliance', 'done');
    setAgentStatus('negotiation', 'done');
    setAgentStatus('scout', 'done');
  };

  const recoveryApproval = approvals.find((a) => a.id === RECOVERY_COST_DELTA_APPROVAL.id && !a.resolved);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1300px] mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Siren className="h-4 w-4 text-redx" />
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-redx font-medium">
            Live Recovery Demo
          </span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-text-primary">
          Emergency Recovery — Equipment Failure
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-text-secondary max-w-2xl">
          Trigger a simulated on-site equipment failure and watch the Emergency Recovery Agent
          auto-source a replacement, renegotiate, and request your approval for the cost delta.
        </p>
      </header>

      {/* Demo control panel */}
      <div className="mb-8 glass-strong rounded-2xl border-redx/30 glow-alert p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-redx/15">
              <AlertTriangle className="h-6 w-6 text-redx" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-ink-text-primary">
                Simulate equipment failure
              </h2>
              <p className="mt-1 text-[12px] text-ink-text-secondary">
                Runs a scripted 8-step recovery sequence into the shared activity feed.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={reset}
              disabled={running}
              className="flex items-center gap-2 rounded-xl border border-ink-border bg-ink-surface/60 px-4 py-2.5 text-[13px] font-medium text-ink-text-secondary transition-all hover:border-ink-border-strong hover:text-ink-text-primary disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              onClick={runSequence}
              disabled={running}
              className={cn(
                'flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-300',
                running
                  ? 'bg-ink-surface text-ink-text-tertiary cursor-not-allowed'
                  : 'bg-redx text-ink-bg hover:bg-redx/90 hover:shadow-xl hover:shadow-redx/25 hover:-translate-y-0.5',
              )}
            >
              {running ? (
                <><span className="h-3.5 w-3.5 rounded-full border-2 border-ink-text-tertiary border-t-transparent animate-spin-slow" />Running…</>
              ) : (
                <><Play className="h-4 w-4" />Simulate equipment failure</>
              )}
            </button>
          </div>
        </div>

        {running && (
          <div className="mt-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-surface">
              <div className="h-full rounded-full bg-redx animate-shimmer" style={{
                backgroundImage: 'linear-gradient(90deg, transparent, #D9654F, transparent)',
                backgroundSize: '200% 100%',
              }} />
            </div>
            <p className="mono mt-2.5 text-[10px] text-redx animate-pulse-dot font-medium">
              RECOVERY SEQUENCE IN PROGRESS…
            </p>
          </div>
        )}
        {completed && !recoveryApproval && (
          <div className="mt-5 flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-greenx/15">
              <span className="h-1.5 w-1.5 rounded-full bg-greenx" />
            </div>
            <span className="mono text-[11px] text-greenx font-medium">RECOVERY COMPLETE — cost delta approved</span>
          </div>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1">
          <div className="mb-4 flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-amberx" />
            <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">Producer Action</h2>
            <div className="flex-1 h-px bg-ink-border" />
          </div>
          {recoveryApproval ? (
            <ApprovalCard approval={recoveryApproval} />
          ) : (
            <div className="glass rounded-xl border-dashed border-ink-border p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-raised">
                <Siren className="h-7 w-7 text-ink-text-tertiary" />
              </div>
              <p className="mt-3 text-[12px] text-ink-text-tertiary leading-relaxed max-w-[240px] mx-auto">
                {running
                  ? 'Waiting for recovery sequence to complete…'
                  : completed
                    ? 'Recovery resolved. Run again to see the full flow.'
                    : 'No action needed yet. Trigger the simulation to see the recovery approval appear here.'}
              </p>
            </div>
          )}
        </div>

        <div className="xl:col-span-2">
          <div className="mb-4 flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-ink-text-tertiary" />
            <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">Shared Activity Feed</h2>
            <div className="flex-1 h-px bg-ink-border" />
          </div>
          <div className="xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto pr-1">
            <ActivityFeed events={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <MissionProvider>
      <AppShell>
        <DemoContent />
      </AppShell>
    </MissionProvider>
  );
}
