#!/usr/bin/env sh
set -e
case "$SERVICE" in
  orchestrator)       exec uvicorn services.orchestrator.main:app       --host 0.0.0.0 --port 8000 ;;
  producer-agent)     exec uvicorn services.producer_agent.main:app     --host 0.0.0.0 --port 8001 ;;
  scout-agent)        exec uvicorn services.scout_agent.main:app        --host 0.0.0.0 --port 8002 ;;
  negotiation-agent)  exec uvicorn services.negotiation_agent.main:app  --host 0.0.0.0 --port 8003 ;;
  compliance-agent)   exec uvicorn services.compliance_agent.main:app   --host 0.0.0.0 --port 8004 ;;
  recovery-agent)     exec uvicorn services.recovery_agent.main:app     --host 0.0.0.0 --port 8005 ;;
  vendor-mock)        exec uvicorn services.vendor_mock.main:app        --host 0.0.0.0 --port "${PORT:-9001}" ;;
  *) echo "unknown SERVICE: $SERVICE" >&2; exit 1 ;;
esac
