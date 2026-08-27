# CineXchange AI — Multi-Agent Backend

FastAPI-powered autonomous production commerce and emergency recovery network for film production.

## Features

- **5 Specialized AI Agents**:
  - **Producer Agent**: Converts natural language requests into structured production requirements & specifications.
  - **Marketplace Scout Agent**: Multi-criteria weighted ranking (suitability, availability, reliability, price, delivery, insurance) with hard filter rejection.
  - **Negotiation Agent**: Multi-round automated counter-offering with deterministic policy guards.
  - **Compliance & Approval Agent**: Document extraction and 5-dimension risk matrix calculation.
  - **Emergency Recovery Agent**: Autonomous incident detection and zero-delay replacement sourcing.
- **Grafana Cloud MCP Integration**: Observability for operational events, incident detection, alerts, and metrics.
- **ClickHouse Analytics Store**: High-throughput telemetry event insertion and historical pricing/recovery analytics.
- **Model Context Protocol (MCP) Server**: Modular tool registry exposing agent capabilities.
- **Deterministic Guardrails**: Strict policy enforcement for budget caps, mandatory insurance, quality thresholds, and producer approval gates.

## Quick Start

### 1. Requirements
- Python 3.11+
- pip

### 2. Setup & Virtual Environment

```bash
cd backend
python -m venv .venv

# On Windows:
.venv\Scripts\activate

# On macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Run Locally

```bash
# Start FastAPI backend on http://localhost:8000
python run.py
# Or using uvicorn directly:
python -m uvicorn backend.app.main:app --port 8000 --reload
```

### 4. Run Test Suite

```bash
python -m pytest backend/tests -v
```

## API Documentation

Interactive Swagger documentation is available at `http://localhost:8000/docs`.
