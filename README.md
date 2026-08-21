# CineXchange AI — Multi-Agent Film & Cinema Procurement Platform

An enterprise-grade autonomous procurement platform for Indian film and cinema productions. CineXchange AI orchestrates **five specialized AI agents** bound by **deterministic Python policy guardrails**, managing everything from natural language shoot brief intake to emergency on-set equipment failure recovery.

---

## 🌟 Key Capabilities

1. **5 Specialized AI Agents**:
   - 🎬 **Producer Agent**: Parses shoot briefs into structured requirements (equipment, crew, logistics, compliance) with technical specs.
   - 🔍 **Marketplace Scout Agent**: Filters simulated vendor catalogs and applies 6-factor weighted multi-criteria ranking.
   - 🤝 **Negotiation Agent**: Autonomous multi-round bargaining (8% target savings) with strict insurance and quality guardrails.
   - 🛡️ **Compliance & Approval Agent**: Evaluates 5-dimension risk matrices (Vendor, Contract, Insurance, Permit, Financial) and enforces producer signoff thresholds (>₹10 Lakh).
   - 🚨 **Emergency Recovery Agent**: Autonomous incident response for equipment failures mid-shoot with live trade-off explanations.

2. **Deterministic Python Policy Engine (`backend/app/agents/common/policies.py`)**:
   - **Quality Standard**: Minimum sensor ISO/quality score $\ge 85.0$.
   - **Budget Cap**: Strict ceiling enforcement (₹25.00 Lakh for scenario).
   - **Mandatory Insurance**: Uninsured packages are strictly rejected regardless of price discount.
   - **Delivery SLA**: Maximum 2-day delivery transit limit.
   - **Negotiation Policy**: Maximum 3 rounds per vendor; target savings 8.0%.
   - **Compliance Governance**: Non-negotiable mandatory forest permits and valid insurance coverage.
   - **Human-in-the-Loop Safeguards**: High-value commitments ($\ge$ ₹10 Lakh) require explicit producer cryptographic authorization.

3. **Complete Shared In-Memory State & Audit Log**:
   - Immutable audit trail (`AuditLogEntry`) capturing every policy evaluation, score breakdown, warning, and next step.
   - Real-time synchronization between FastAPI backend and Next.js frontend.

4. **Model Context Protocol (MCP) Server**:
   - Standardized FastMCP server (`backend/app/integrations/mcp_server.py`) exposing agent tools:
     - `search_resources`, `rank_candidates`, `submit_counter_offer`, `evaluate_compliance`, `trigger_recovery`.

---

## 🎬 Core Scenario: "Rainforest Night Shoot"

- **Brief**: *"We need to shoot two low-light rainforest scenes over three days within ₹25 lakh."*
- **Location**: Western Ghats (Agumbe Eco-Sensitive Buffer Zone).
- **Duration**: 3 Shoot Days (consecutive night shifts).
- **Allocated Budget**: ₹25,00,000 (₹25.00 Lakh).
- **Extracted Requirements**:
  1. Primary Cinema Camera (ARRI Alexa Mini LF / Sony FX9) with Dual-Base ISO for low light.
  2. B-Camera Gimbal Rig.
  3. Weatherproof Astera Titan LED Tube Kit (IP65).
  4. Silent 15kVA Inverter Diesel Generator (<55dB for forest eco-zone).
  5. DJI Inspire 3 Aerial Cinema Drone.
  6. DGCA Night-Endorsed Drone Pilot.
  7. 4WD All-Terrain Crew Transport.
  8. All-Risk Shoot Insurance Policy (₹25L+ cover).
  9. Karnataka Forest Dept. Night Filming Clearance.

---

## 🚨 Emergency Recovery Scenario: On-Set Camera Failure

- **Trigger**: Booked camera **CAM-001** (ARRI Alexa Mini LF) suffers an unexpected sensor failure during the Agumbe night shoot.
- **Candidate Evaluation**:
  - **CAM-002 (Sony FX9)**: ₹4,88,000 (+₹8,000 cost delta over original ₹4,80,000), located in Agumbe Hub (12 km away), same-day emergency dispatch (**0 schedule delay**), fully insured.
  - **CAM-003 (Blackmagic 6K)**: ₹3,20,000 (cheaper by ₹1.6L), but lacks low-light dual ISO sensitivity, uninsured, and takes 2 days to arrive (**2-day schedule delay, ₹4.5L idle crew loss**).
  - **CAM-004 (RED V-Raptor)**: Currently rented to another production (**Unavailable**).
- **Agent Recommendation Explanation**:
  > *"Sony FX9 / CAM-002 from ForestFrame Rentals is ₹8,000 more expensive, but it is 12 km away and can be delivered today, resulting in zero schedule delay."*

---

## 📂 Repository Structure

```
cinexchange-ai/
├── backend/                        # FastAPI Backend
│   ├── app/
│   │   ├── agents/                 # 5 Specialized AI Agents
│   │   │   ├── common/             # BaseAgent, schemas, policies, evaluator, state, llm
│   │   │   ├── producer/           # Producer Agent
│   │   │   ├── scout/              # Marketplace Scout Agent
│   │   │   ├── negotiation/        # Negotiation Agent
│   │   │   ├── compliance/         # Compliance & Approval Agent
│   │   │   └── recovery/           # Emergency Recovery Agent
│   │   ├── api/                    # REST routes and response models
│   │   ├── config.py               # Pydantic environment settings
│   │   ├── integrations/           # Mock database, Client, FastMCP server
│   │   ├── orchestration/          # ProductionWorkflow state machine
│   │   └── main.py                 # FastAPI application entrypoint
│   ├── data/                       # Mock Indian cinema datasets
│   │   ├── sample_project.json
│   │   ├── vendors.json
│   │   ├── resources.json
│   │   └── documents.json
│   ├── tests/                      # Pytest automated test suite (14 test cases)
│   └── requirements.txt
├── app/                            # Next.js 13.5 App Router
│   ├── ai-planner/                 # AI Production Planner UI Views
│   │   ├── page.tsx                # Overview Hub & Agent Pipeline
│   │   ├── requirements/page.tsx   # Producer Agent Review
│   │   ├── marketplace/page.tsx    # Scout Agent Discovery & Ranking
│   │   ├── negotiation/page.tsx    # Negotiation Workspace & Counters
│   │   ├── compliance/page.tsx     # Compliance Center & Risk Matrix
│   │   ├── booking/page.tsx        # Procurement Commitments
│   │   ├── recovery/page.tsx       # Emergency Recovery Center
│   │   └── audit/page.tsx          # Chronological Audit Stream & JSON Inspector
│   ├── dashboard/                  # Live Mission Control
│   ├── booking/                    # 10-Step Pipeline Architecture Guide
│   ├── demo/                       # Interactive Recovery Simulation
│   ├── globals.css                 # Dark theme tokens (amberx, greenx, redx, bluex)
│   └── layout.tsx
├── components/
│   └── shared/                     # Reusable UI components
│       ├── agent-activity-timeline.tsx
│       ├── workflow-stepper.tsx
│       ├── demo-badge.tsx
│       ├── sidebar.tsx
│       └── app-shell.tsx
├── lib/
│   ├── api-client.ts               # Typed client for backend REST API
│   ├── mission-context.tsx         # Unified state provider
│   ├── types.ts                    # Full-stack data contracts
│   └── mockData.ts
└── package.json
```

---

## 🚀 Quick Start Guide

### 1. Backend Setup & Test Verification

```bash
# Navigate to project root
cd cinexchange-ai

# Run automated backend test suite
python -m pytest backend/tests -v

# Start FastAPI server on port 8000
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend API Swagger Docs: `http://localhost:8000/docs`

### 2. Frontend Setup

```bash
# Install frontend dependencies
npm install

# Start Next.js development server
npm run dev
```

Open `http://localhost:3000` to launch the CineXchange AI Mission Control.

---

## 📡 REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Service health status and agent readiness |
| `/api/projects/plan` | `POST` | Producer Agent requirement extraction |
| `/api/projects/{id}/state` | `GET` | Current synchronized production state |
| `/api/projects/{id}/scout` | `POST` | Marketplace Scout search & 6-factor ranking |
| `/api/projects/{id}/negotiations` | `POST` | Start vendor negotiation session |
| `/api/projects/{id}/negotiations/{neg_id}/counter` | `POST` | Submit counter-offer (8% target savings) |
| `/api/projects/{id}/negotiations/{neg_id}/accept` | `POST` | Accept valid vendor offer |
| `/api/projects/{id}/compliance` | `POST` | Compliance evaluation & 5-dimension risk scoring |
| `/api/projects/{id}/approvals/{appr_id}/approve` | `POST` | Producer authorization & booking creation |
| `/api/projects/{id}/approvals/{appr_id}/reject` | `POST` | Reject non-compliant deal |
| `/api/projects/{id}/incidents` | `POST` | Trigger equipment failure incident |
| `/api/projects/{id}/recovery` | `POST` | Recovery Agent replacement ranking |
| `/api/projects/{id}/recovery/approve` | `POST` | Authorize replacement dispatch |
| `/api/projects/{id}/audit` | `GET` | Chronological audit log |
| `/api/mcp/tools` | `GET` | List available Model Context Protocol tools |
| `/api/mcp/tools/call` | `POST` | Execute MCP tool call |

---

## 🛡️ License

MIT License. Built for CineXchange AI.
