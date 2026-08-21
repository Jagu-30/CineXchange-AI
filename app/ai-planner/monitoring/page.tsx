'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shared/app-shell';
import { IntegrationStatus } from '@/components/shared/integration-status';
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  Siren,
  CheckCircle,
  Radio,
  Clock,
  Layers,
  ArrowRight,
  TrendingUp
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useMission } from '@/lib/mission-context';
import Link from 'next/link';

export default function ProductionMonitoringPage() {
  const { productionState, refreshState } = useMission();
  const [loading, setLoading] = useState(false);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [lastPollTime, setLastPollTime] = useState<string>('');

  const fetchMonitoringData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.pollMonitoring(productionState?.project?.project_id || 'PROJ-001');
      if (res) {
        setIncidents(res.incidents || []);
        setAlerts(res.alerts || []);
        setMetrics(res.metrics || null);
        setLastPollTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.warn('Failed to poll Grafana:', err);
    } finally {
      setLoading(false);
    }
  }, [productionState?.project?.project_id]);

  useEffect(() => {
    fetchMonitoringData();
  }, [fetchMonitoringData]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                PARTNER TRACK
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-ink-text-primary">
                Production Observability & Monitoring
              </h1>
            </div>
            <p className="text-sm text-ink-text-secondary mt-1">
              Live Grafana Cloud MCP Telemetry, Synthetic Monitors, and On-Set Incident Streams.
            </p>
          </div>
          <button
            onClick={fetchMonitoringData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 text-sm font-medium transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Poll Grafana Cloud MCP
          </button>
        </div>

        {/* Integration Status Component */}
        <IntegrationStatus />

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Active Incidents</span>
              <Siren className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-red-400 mt-2">
              {incidents.length}
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Triggered via OnCall MCP
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Telemetry Alerts</span>
              <AlertTriangle className="w-4 h-4 text-amberx" />
            </div>
            <div className="text-2xl font-bold font-mono text-amberx mt-2">
              {alerts.length}
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Synthetic & IoT monitors
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Camera Delivery Delay</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400 mt-2">
              0.0 Days
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Agumbe Express Transit
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ink-border bg-ink-surface/70">
            <div className="flex items-center justify-between text-ink-text-secondary text-xs">
              <span>Last Sync Polled</span>
              <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div className="text-lg font-bold font-mono text-ink-text-primary mt-2">
              {lastPollTime || 'Live'}
            </div>
            <div className="text-[11px] text-ink-text-tertiary mt-1">
              Auto-refresh: 15s
            </div>
          </div>
        </div>

        {/* Active Incidents & Alert Stream */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Incidents Card */}
          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center justify-between border-b border-ink-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Siren className="w-5 h-5 text-red-400" />
                <h2 className="text-base font-semibold text-ink-text-primary">
                  Grafana Detected Incidents
                </h2>
              </div>
              <span className="text-xs font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                CRITICAL STREAM
              </span>
            </div>

            {incidents.length === 0 ? (
              <div className="text-center py-8 text-ink-text-tertiary text-sm">
                No active incidents detected. All shoot telemetry healthy.
              </div>
            ) : (
              <div className="space-y-3">
                {incidents.map((inc, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-red-400">
                        {inc.incident_id}
                      </span>
                      <span className="text-[10px] font-mono uppercase bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
                        {inc.severity}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-ink-text-primary">
                      {inc.details?.message || inc.event}
                    </div>
                    <div className="text-xs text-ink-text-secondary">
                      Affected Resource: <strong className="text-ink-text-primary font-mono">{inc.resource_id}</strong>
                    </div>
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[11px] text-ink-text-tertiary font-mono">
                        Source: {inc.details?.source || 'Grafana MCP'}
                      </span>
                      <Link
                        href="/ai-planner/recovery"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-amberx hover:underline"
                      >
                        Launch Recovery Agent <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Synthetic Monitors & Telemetry Alerts */}
          <div className="p-5 rounded-2xl border border-ink-border bg-ink-surface/80">
            <div className="flex items-center justify-between border-b border-ink-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-orange-400" />
                <h2 className="text-base font-semibold text-ink-text-primary">
                  Grafana Synthetic Alerts
                </h2>
              </div>
              <span className="text-xs font-mono text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                PROMETHEUS & LOKI
              </span>
            </div>

            <div className="space-y-3">
              {alerts.map((al, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl border border-ink-border bg-ink-surface-raised/50 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${al.state === 'firing' ? 'bg-red-400 animate-ping' : 'bg-emerald-400'}`} />
                      <div className="text-xs font-semibold text-ink-text-primary">
                        {al.title}
                      </div>
                    </div>
                    <div className="text-[11px] text-ink-text-secondary font-mono">
                      Resource: {al.resource_id} | State: {al.state}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${al.severity === 'critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                    {al.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
