# CineXchange AI — Full-Stack Agent Layer Integration Plan

## 1. Repository Structure Summary

| Dimension | Finding | Details |
| :--- | :--- | :--- |
| **Frontend Framework** | Next.js 13.5.1 | App Router (`app/` directory), React 18.2.0 |
| **Language** | TypeScript 5.2.2 (Frontend) / Python 3.11+ (Backend) | Strict TypeScript type checking, Pydantic v2 schemas |
| **Package Manager** | `npm` | `package.json` with locked dependencies |
| **Styling & Theme** | TailwindCSS 3.3.3 + Vanilla CSS | Custom deep cinematic control-room theme (`#080A0E` background, `#0E1117` surface, `amberx`, `greenx`, `redx`, `bluex` accents, glassmorphism) |
| **Component Library** | Radix UI Primitives + Lucide Icons | Full set of `@radix-ui/react-*` components in `components/ui/`, Lucide React icons, Recharts |
| **State Management** | React Context (`MissionProvider`) + REST sync | `lib/mission-context.tsx` synced with FastAPI backend and mock fallback |
| **Backend Framework** | FastAPI + Pydantic v2 + Uvicorn | `backend/app/` with 5 specialized AI agents, MCP server, Grafana & ClickHouse adapters |

---

## 2. Existing Routes & Navigation

| Route | Purpose | Components Reused |
| :--- | :--- | :--- |
| `/` | Natural Language Project Intake | `AppShell`, `DemoBadge`, `WorkflowStepper` |
| `/dashboard` | Mission Control Overview & Agent KPI Hub | `AppShell`, `AgentStatusCard`, `ApprovalCard`, `ActivityFeed`, `BudgetChart` |
| `/ai-planner` | End-to-End Autonomous Workflow Hub | `AppShell`, `WorkflowStepper`, `IntegrationStatus` |
| `/ai-planner/requirements` | Producer Agent Requirement Review & Specs | `AppShell`, `RequirementsTable`, `WorkflowStepper` |
| `/ai-planner/marketplace` | Scout Agent Candidate Ranking & Rejection | `AppShell`, `WorkflowStepper`, `IntegrationStatus` |
| `/ai-planner/negotiation` | Negotiation Agent Counter-Offers & Timeline | `AppShell`, `WorkflowStepper`, `ApprovalCard` |
| `/ai-planner/compliance` | Compliance Agent Risk Matrix & Approvals | `AppShell`, `ApprovalCard`, `WorkflowStepper` |
| `/ai-planner/booking` | Simulated Booking Confirmation & Telemetry | `AppShell`, `WorkflowStepper`, `IntegrationStatus` |
| `/ai-planner/monitoring` | Grafana Incident Detection & Alert Telemetry | `AppShell`, `IntegrationStatus`, `WorkflowStepper` |
| `/ai-planner/recovery` | Emergency Recovery Agent (CAM-001 -> CAM-002) | `AppShell`, `ApprovalCard`, `WorkflowStepper` |
| `/ai-planner/analytics` | ClickHouse Telemetry & Price Trend Analytics | `AppShell`, `IntegrationStatus`, `WorkflowStepper` |
| `/ai-planner/audit` | Chronological Agent Activity Log & State | `AppShell`, `AgentActivityTimeline` |
| `/booking` | Pipeline Architecture Reference Guide | `AppShell`, `DemoBadge` |
| `/demo` | Simulated Emergency Recovery Sandbox | `AppShell`, `AgentStatusCard`, `ApprovalCard` |

---

## 3. Reusable Components

- **Shell & Navigation**: `components/shared/app-shell.tsx`, `components/shared/sidebar.tsx`, `components/shared/demo-badge.tsx`
- **Agent Visualization**: `components/shared/agent-status-card.tsx`, `components/shared/agent-activity-timeline.tsx`, `components/shared/activity-feed.tsx`
- **Workflow & Actions**: `components/shared/workflow-stepper.tsx`, `components/shared/approval-card.tsx`, `components/shared/requirements-table.tsx`, `components/shared/budget-chart.tsx`
- **System Telemetry**: `components/shared/integration-status.tsx`
- **UI Primitives**: All 47 Radix UI components in `components/ui/` (`badge`, `button`, `card`, `dialog`, `select`, `tabs`, `table`, etc.).

---

## 4. Required New Files & Modified Files

### Files Modified:
- `lib/types.ts`: Synchronized TypeScript types with backend Pydantic schemas.
- `lib/mission-context.tsx`: Unified context providing real-time backend synchronization and offline mock fallback.
- `app/layout.tsx`: Root layout with client `<Providers>` boundary.
- `app/providers.tsx`: Client provider wrapper for `<MissionProvider>`.
- `components/shared/sidebar.tsx`: Sub-navigation for all AI Planner routes and live system indicators.

### Files Created:
- `lib/api-client.ts`: Typed API client for FastAPI endpoints with graceful fallback.
- `components/shared/agent-activity-timeline.tsx`: Timeline for agent tool executions, Grafana queries, and policy checks.
- `components/shared/integration-status.tsx`: Live status indicators for Grafana, ClickHouse, and Gemini.
- `components/shared/workflow-stepper.tsx`: Interactive workflow stepper for the 10-step autonomous pipeline.
- `app/ai-planner/` routes: `page.tsx`, `requirements/`, `marketplace/`, `negotiation/`, `compliance/`, `booking/`, `monitoring/`, `recovery/`, `analytics/`, `audit/`.
- `backend/`:
  - `backend/app/main.py`, `config.py`, `dependencies.py`
  - `backend/app/api/routes.py`, `models.py`
  - `backend/app/agents/common/` (`schemas.py`, `state.py`, `policies.py`, `llm.py`, `agent_base.py`, `evaluator.py`, `exceptions.py`)
  - `backend/app/agents/producer/`, `scout/`, `negotiation/`, `compliance/`, `recovery/`
  - `backend/app/integrations/` (`grafana_client.py`, `clickhouse_client.py`, `mock_backend.py`, `backend_client.py`, `mcp_server.py`)
  - `backend/app/orchestration/workflow.py`
  - `backend/data/` (`vendors.json`, `resources.json`, `documents.json`, `operational_events.json`, `sample_project.json`)
  - `backend/tests/` (11 comprehensive test files, 30 automated tests)
  - `backend/requirements.txt`, `backend/.env.example`, `backend/README.md`

---

## 5. Frontend-Backend Integration Plan

- **Protocol**: RESTful HTTP / JSON envelope (`success`, `data`, `errors`, `request_id`, `timestamp`).
- **Base URL**: `http://localhost:8000` (configurable via `NEXT_PUBLIC_API_BASE_URL`).
- **State Synchronization**: `lib/mission-context.tsx` automatically invokes `/api/projects/{id}/state` and provides action functions (`planProject`, `runScout`, `startNegotiation`, `submitCounterOffer`, `acceptOffer`, `runCompliance`, `approveDecision`, `triggerIncident`, `runRecovery`, `approveRecovery`).
- **Resilience**: If backend is temporarily offline, `apiClient` gracefully serves local mock data so the UI remains interactive.

---

## 6. Grafana Integration Plan

- **Modes**:
  - `GRAFANA_MODE=mock`: In-memory event stream and telemetry queries with pre-seeded demo incident `INC-GRAFANA-001` on resource `CAM-001`.
  - `GRAFANA_MODE=cloud_mcp`: Direct integration with Grafana Cloud MCP endpoint using Bearer token authentication.
- **Runtime Flow**:
  1. All agent lifecycle actions emit structured `OperationalEvent` objects to Grafana.
  2. In the demo failure scenario, resource `CAM-001` failure emits `resource_unavailable`.
  3. The `EmergencyRecoveryAgent` directly queries `grafana_client.get_incidents()` before initiating recovery.
  4. The incident ID `INC-GRAFANA-001` is attached to `ProductionState` and displayed in the recovery workspace.
- **Endpoints**:
  - `GET /api/projects/{id}/grafana/incidents`
  - `GET /api/projects/{id}/grafana/alerts`
  - `GET /api/projects/{id}/grafana/metrics`
  - `POST /api/projects/{id}/monitoring/poll`

---

## 7. ClickHouse Integration Plan

- **Modes**:
  - `CLICKHOUSE_MODE=mock`: In-memory and file-backed table `production_events` with realistic analytics calculations.
  - `CLICKHOUSE_MODE=cloud`: Native / HTTP connection to ClickHouse Cloud cluster.
- **Table Schema**:
  - `production_events`: `event_id`, `event_type`, `project_id`, `resource_id`, `vendor_id`, `agent_name`, `timestamp`, `severity`, `payload`, `trace_id`.
- **Runtime Analytics**:
  - Vendor historical pricing trends and average discounts.
  - Negotiation savings percentages and average rounds to close.
  - Emergency recovery frequency, average cost delta, and zero schedule delay confirmation.
- **Endpoints**:
  - `GET /api/projects/{id}/analytics`

---

## 8. Test Plan

- **Unit & Agent Tests**:
  - Producer: Structured extraction and validation (`test_producer.py`).
  - Scout: Multi-criteria ranking, hard filtering for uninspected or unavailable items (`test_scout.py`).
  - Negotiation: Multi-round counter offering and rejection of invalid uninspected offers (`test_negotiation.py`).
  - Compliance: Document validity checking and high-value threshold escalation (`test_compliance.py`).
  - Recovery: Incident handling and selection of CAM-002 replacement (`test_recovery.py`).
- **Integration Tests**:
  - Grafana & ClickHouse: Mock operations, incident retrieval, and analytics queries (`test_grafana_clickhouse.py`, `test_clickhouse_analytics.py`).
  - Full E2E: 19-step autonomous lifecycle verification (`test_complete_integration.py`, `test_workflow.py`).
  - Provider Structure: Root client provider verification (`test_provider_structure.py`).
- **Frontend Verification**:
  - TypeScript compilation (`npm run typecheck`).
  - Next.js production build (`npm run build`).
