'use client';

// Grafana integration was never implemented. `monitoring/poll`,
// `grafana/incidents`, `grafana/alerts` and `grafana/metrics` do not exist on
// the backend and never will — this backend has no Grafana MCP client at all.
// The previous version of this page called `apiClient.pollMonitoring`, a
// method that never existed on this client, and silently fell back to a fake
// `INC-001` incident and a hardcoded "Camera Delivery Delay: 0.0 Days" tile
// whenever that call failed — which was always.
//
// The one genuinely real signal available here is per-agent MCP reachability
// via GET /healthz, surfaced through <IntegrationStatus />. It is labelled as
// agent health, not production monitoring, because it is not the same thing:
// it says whether the orchestrator can currently reach each MCP agent, not
// whether anything is wrong on set.

import { AppShell } from '@/components/shared/app-shell';
import { IntegrationStatus } from '@/components/shared/integration-status';
import { Ban, Radio } from 'lucide-react';

function MonitoringContent() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-ink-text-tertiary/10 text-ink-text-tertiary border border-ink-border">
              NOT IMPLEMENTED
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-ink-text-primary">
              Production Observability & Monitoring
            </h1>
          </div>
          <p className="text-sm text-ink-text-secondary mt-1">
            Grafana Cloud integration was never built for this backend. What&apos;s shown below is real
            agent reachability — not production telemetry.
          </p>
        </div>
      </div>

      {/* The one real signal on this page */}
      <div>
        <div className="mb-3 flex items-center gap-2.5">
          <Radio className="h-4 w-4 text-amberx" />
          <h2 className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-text-secondary">
            Real signal: agent health, not production monitoring
          </h2>
        </div>
        <IntegrationStatus />
      </div>

      {/* Honest unavailable state */}
      <div className="p-6 rounded-2xl border border-ink-border bg-ink-surface/80">
        <div className="flex items-center gap-2 border-b border-ink-border pb-3 mb-4">
          <Ban className="w-5 h-5 text-ink-text-tertiary" />
          <h2 className="text-base font-semibold text-ink-text-primary">Not Available In This Build</h2>
        </div>
        <p className="text-[12.5px] text-ink-text-secondary leading-relaxed">
          Grafana Cloud monitoring was never implemented in this backend. There is no{' '}
          <code>monitoring/poll</code>, <code>grafana/incidents</code>, <code>grafana/alerts</code>, or{' '}
          <code>grafana/metrics</code> endpoint — none of these exist, and none are planned. The panels
          below cannot be shown honestly and are intentionally omitted rather than faked:
        </p>
        <ul className="mt-3 space-y-1.5 text-[12px] text-ink-text-tertiary">
          <li>• Active incident stream (there is no incident source — only production `recovery_events`, which is a different concept and lives on the production detail page, not here)</li>
          <li>• Synthetic monitors / Prometheus / Loki telemetry alerts</li>
          <li>• On-set equipment or delivery delay metrics</li>
          <li>• Any auto-refreshing "last polled" telemetry timestamp</li>
        </ul>
      </div>
    </div>
  );
}

export default function ProductionMonitoringPage() {
  return (
    <AppShell>
      <MonitoringContent />
    </AppShell>
  );
}
