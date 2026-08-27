'use client';

import { useEffect, useState } from 'react';
import { Activity, Database, Cpu, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { IntegrationStatus as IIntegrationStatus } from '@/lib/types';

export function IntegrationStatus() {
  const [status, setStatus] = useState<IIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getIntegrationStatus();
      setStatus(data);
    } catch (err: any) {
      console.warn('Failed to fetch integration status:', err.message);
      // Fallback local status
      setStatus({
        grafana: {
          mode: 'MOCK',
          status: 'CONNECTED',
          endpoint: 'local://mock_grafana',
          incident_count: 1,
          alert_count: 2,
        },
        clickhouse: {
          mode: 'MOCK',
          status: 'CONNECTED',
          table: 'production_events',
          endpoint: 'local://mock_clickhouse',
          events_stored: 3,
          analytics_available: true,
        },
        agent_platform: {
          mode: 'MOCK_FALLBACK',
          model: 'gemini-2.5-flash',
          status: 'ACTIVE_LOCAL',
          api_key_configured: false,
          last_call: new Date().toISOString(),
        },
        mock_mode: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const renderBadge = (st: string) => {
    if (st === 'CONNECTED' || st === 'ACTIVE_LOCAL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle className="w-3 h-3" /> {st}
        </span>
      );
    }
    if (st === 'NOT_CONFIGURED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3" /> NOT CONFIGURED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
        <XCircle className="w-3 h-3" /> {st || 'ERROR'}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-xl border border-ink-border bg-ink-surface-raised/60 backdrop-blur-md">
      {/* Grafana */}
      <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-ink-border/60 bg-ink-surface/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold text-ink-text-primary">Grafana MCP</span>
          </div>
          {renderBadge(status.grafana?.status)}
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-text-secondary mt-1">
          <span>Mode: <strong className="text-ink-text-primary font-mono">{status.grafana?.mode}</strong></span>
          <span>Incidents: <strong className="text-orange-400 font-mono">{status.grafana?.incident_count ?? 0}</strong></span>
        </div>
        <div className="text-[10px] text-ink-text-tertiary truncate font-mono mt-0.5">
          {status.grafana?.endpoint}
        </div>
      </div>

      {/* ClickHouse */}
      <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-ink-border/60 bg-ink-surface/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-yellow-400" />
            <span className="text-xs font-semibold text-ink-text-primary">ClickHouse Analytics</span>
          </div>
          {renderBadge(status.clickhouse?.status)}
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-text-secondary mt-1">
          <span>Mode: <strong className="text-ink-text-primary font-mono">{status.clickhouse?.mode}</strong></span>
          <span>Events: <strong className="text-yellow-400 font-mono">{status.clickhouse?.events_stored ?? 0}</strong></span>
        </div>
        <div className="text-[10px] text-ink-text-tertiary truncate font-mono mt-0.5">
          Table: {status.clickhouse?.table || 'production_events'}
        </div>
      </div>

      {/* Agent Platform */}
      <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-ink-border/60 bg-ink-surface/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amberx" />
            <span className="text-xs font-semibold text-ink-text-primary">Agent Platform</span>
          </div>
          {renderBadge(status.agent_platform?.status)}
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-text-secondary mt-1">
          <span>Engine: <strong className="text-ink-text-primary font-mono">{status.agent_platform?.mode}</strong></span>
          <span>Model: <strong className="text-amberx font-mono">{status.agent_platform?.model}</strong></span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-ink-text-tertiary mt-0.5">
          <span>Policy: Strict Python</span>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1 hover:text-amberx transition"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
