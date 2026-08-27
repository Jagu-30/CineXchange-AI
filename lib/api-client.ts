import type {
  ProjectInput,
  ProductionState,
  CounterOfferInput,
  APIResponseEnvelope,
  AuditLogEntry,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

class CineXchangeApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    try {
      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`API error ${res.status}: ${errorText || res.statusText}`);
      }

      const json: APIResponseEnvelope<T> = await res.json();
      if (!json.success && json.errors && json.errors.length > 0) {
        throw new Error(json.errors.join('; '));
      }

      return json.data as T;
    } catch (err: any) {
      console.warn(`[ApiClient] Request to ${endpoint} failed:`, err.message);
      throw err;
    }
  }

  // 1. Create plan / Producer agent
  async createProjectPlan(input: ProjectInput): Promise<ProductionState> {
    return this.request<ProductionState>('/api/projects/plan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // 2. Get state
  async getProjectState(projectId: string = 'PROJ-001'): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/state`, {
      method: 'GET',
    });
  }

  // 3. Run Scout
  async runScout(projectId: string = 'PROJ-001'): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/scout`, {
      method: 'POST',
    });
  }

  // 4. Start Negotiation
  async startNegotiation(
    projectId: string = 'PROJ-001',
    vendorId: string = 'V003',
    resourceId: string = 'CAM-002',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/negotiations`, {
      method: 'POST',
      body: JSON.stringify({ vendor_id: vendorId, resource_id: resourceId }),
    });
  }

  // 5. Submit Counter Offer
  async submitCounterOffer(
    projectId: string,
    negotiationId: string,
    input: CounterOfferInput,
  ): Promise<ProductionState> {
    return this.request<ProductionState>(
      `/api/projects/${projectId}/negotiations/${negotiationId}/counter`,
      {
        method: 'POST',
        body: JSON.stringify({
          price: input.price,
          requested_terms: input.requested_terms || {
            insurance: true,
            delivery_days: 1,
            warranty: true,
          },
          reason: input.reason,
        }),
      },
    );
  }

  // 6. Accept Offer
  async acceptOffer(
    projectId: string,
    negotiationId: string,
  ): Promise<ProductionState> {
    return this.request<ProductionState>(
      `/api/projects/${projectId}/negotiations/${negotiationId}/accept`,
      {
        method: 'POST',
      },
    );
  }

  // 7. Run Compliance
  async runCompliance(
    projectId: string = 'PROJ-001',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/compliance`, {
      method: 'POST',
    });
  }

  // 8. Producer Decisions
  async approveDecision(
    projectId: string,
    approvalId: string,
    notes: string = 'Producer approved package commitments',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(
      `/api/projects/${projectId}/approvals/${approvalId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ notes }),
      },
    );
  }

  async rejectDecision(
    projectId: string,
    approvalId: string,
    notes: string = 'Producer rejected package',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(
      `/api/projects/${projectId}/approvals/${approvalId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ notes }),
      },
    );
  }

  // 9. Emergency Incident
  async createIncident(
    projectId: string = 'PROJ-001',
    event: string = 'RESOURCE_UNAVAILABLE',
    resourceId: string = 'CAM-001',
    message: string = 'Booked camera became unavailable mid-shoot',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/incidents`, {
      method: 'POST',
      body: JSON.stringify({
        event,
        resource_id: resourceId,
        severity: 'HIGH',
        details: { message },
      }),
    });
  }

  // 10. Run Recovery
  async runRecovery(
    projectId: string = 'PROJ-001',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/recovery`, {
      method: 'POST',
    });
  }

  // 11. Approve Recovery
  async approveRecovery(
    projectId: string = 'PROJ-001',
    recoveryOptionId: string = 'CAM-002',
    notes: string = 'Approved replacement Sony FX9 package',
  ): Promise<ProductionState> {
    return this.request<ProductionState>(`/api/projects/${projectId}/recovery/approve`, {
      method: 'POST',
      body: JSON.stringify({ recovery_option_id: recoveryOptionId, notes }),
    });
  }

  // 12. Audit
  async getAuditLog(projectId: string = 'PROJ-001'): Promise<AuditLogEntry[]> {
    return this.request<AuditLogEntry[]>(`/api/projects/${projectId}/audit`, {
      method: 'GET',
    });
  }

  // 13. Integration Status
  async getIntegrationStatus(): Promise<any> {
    return this.request<any>('/api/integrations/status', {
      method: 'GET',
    });
  }

  // 14. Monitoring: Poll Grafana
  async pollMonitoring(projectId: string = 'PROJ-001'): Promise<any> {
    return this.request<any>(`/api/projects/${projectId}/monitoring/poll`, {
      method: 'POST',
    });
  }

  // 15. Grafana Incidents, Alerts, Metrics
  async getGrafanaIncidents(projectId: string = 'PROJ-001'): Promise<any[]> {
    return this.request<any[]>(`/api/projects/${projectId}/grafana/incidents`, {
      method: 'GET',
    });
  }

  async getGrafanaAlerts(projectId: string = 'PROJ-001'): Promise<any[]> {
    return this.request<any[]>(`/api/projects/${projectId}/grafana/alerts`, {
      method: 'GET',
    });
  }

  async getGrafanaMetrics(projectId: string = 'PROJ-001'): Promise<any> {
    return this.request<any>(`/api/projects/${projectId}/grafana/metrics`, {
      method: 'GET',
    });
  }

  // 16. ClickHouse Analytics
  async getAnalytics(projectId: string = 'PROJ-001'): Promise<any> {
    return this.request<any>(`/api/projects/${projectId}/analytics`, {
      method: 'GET',
    });
  }
}

export const apiClient = new CineXchangeApiClient();

