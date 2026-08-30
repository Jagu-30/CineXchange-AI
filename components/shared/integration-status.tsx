'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, RefreshCw, XCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { HealthResponse } from '@/lib/types';

// The previous version of this component reported a Grafana/ClickHouse
// MOCK-vs-CLOUD "integration status" from an endpoint (`getIntegrationStatus`)
// that was never built and never will be — the fields it rendered (incident
// counts, event counts, connection endpoints) were a hardcoded local fallback,
// not real data. GET /healthz reports something genuinely real instead: which
// MCP agents the orchestrator can reach right now. This component shows that,
// and nothing it cannot back with an actual response.

export interface IntegrationStatusProps {
  /** Poll interval in ms. Defaults to 15s; pass 0 to disable polling. */
  pollIntervalMs?: number;
  className?: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; health: HealthResponse };

export function IntegrationStatus({ pollIntervalMs = 15000, className = '' }: IntegrationStatusProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const health = await apiClient.getHealth();
      setState({ kind: 'loaded', health });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not reach the health endpoint.',
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    if (!pollIntervalMs) return;
    const interval = setInterval(fetchStatus, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  return (
    <div className={`rounded-xl border border-ink-border bg-ink-surface-raised/60 p-3 backdrop-blur-md ${className}`}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amberx" />
          <span className="text-xs font-semibold text-ink-text-primary">Agent Reachability</span>
          <span className="text-[10px] text-ink-text-tertiary">(GET /healthz)</span>
        </div>
        <button
          onClick={fetchStatus}
          disabled={refreshing}
          className="flex items-center gap-1 text-[11px] text-ink-text-tertiary hover:text-amberx transition"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {state.kind === 'loading' && (
        <div className="text-[11px] text-ink-text-tertiary px-1 py-2">Checking agent health…</div>
      )}

      {state.kind === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-redx/25 bg-redx/10 p-2.5 text-[11px] text-redx">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Health check unavailable — {state.message}</span>
        </div>
      )}

      {state.kind === 'loaded' && (
        <div className="space-y-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
              state.health.ok
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            {state.health.ok ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {state.health.ok ? 'All reachable' : 'Degraded'}
          </div>

          {Object.keys(state.health.agents).length === 0 ? (
            <div className="text-[11px] text-ink-text-tertiary px-1">No agents reported.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(state.health.agents).map(([name, value]) => {
                const reachable = Array.isArray(value);
                return (
                  <div
                    key={name}
                    className="flex flex-col gap-1 rounded-lg border border-ink-border/60 bg-ink-surface/50 p-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-medium text-ink-text-primary truncate">{name}</span>
                      {reachable ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                          <CheckCircle className="w-3 h-3" /> reachable
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-redx">
                          <XCircle className="w-3 h-3" /> unreachable
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-ink-text-tertiary font-mono truncate">
                      {reachable
                        ? (value as string[]).length > 0
                          ? `${(value as string[]).length} tool(s): ${(value as string[]).join(', ')}`
                          : 'no tools reported'
                        : (value as string)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
