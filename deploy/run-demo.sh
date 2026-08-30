#!/usr/bin/env bash
# Drive one full production on the deployed stack and print what the agents did.
# A file, not an inline ssh --command: quoting JSON keys through a remote
# double-quoted string is where several earlier attempts died.
#
# Run on the VM:  bash run-demo.sh
set -euo pipefail
cd /opt/cinexchange

API=localhost:8000
jqp() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -s -X POST "$API/auth/token" | jqp "['access_token']")
PID=$(curl -s -X POST "$API/productions" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d @scripts/brief.json | jqp "['production_id']")
echo "production: $PID"

for i in $(seq 1 40); do
  BODY=$(curl -s "$API/productions/$PID/status" -H "Authorization: Bearer $TOKEN")
  ST=$(printf '%s' "$BODY" | jqp "['status']")
  STEP=$(printf '%s' "$BODY" | jqp "['current_step']")
  case "$ST" in
    booked|awaiting_approval|failed)
      echo "settled at t+$((i * 5))s: $ST (step $STEP)"
      break ;;
  esac
  sleep 5
done

echo
echo "=== negotiation rounds, this production only ==="
sudo docker compose exec -T postgres psql -U cinex -d cinex -c "
SELECT payload->>'vendor_name'  AS vendor,
       payload->>'round'        AS rnd,
       payload->>'offered'      AS agent_offered,
       payload->>'decision'     AS vendor_said,
       payload->>'vendor_price' AS vendor_countered
FROM audit_log
WHERE action = 'negotiation_round'
  AND created_at > now() - interval '10 minutes'
ORDER BY seq LIMIT 14;"

echo "=== rounds per outcome (is it haggling now?) ==="
sudo docker compose exec -T postgres psql -U cinex -d cinex -c "
SELECT payload->>'decision' AS vendor_said,
       payload->>'round'    AS rnd,
       count(*)
FROM audit_log
WHERE action = 'negotiation_round'
  AND created_at > now() - interval '10 minutes'
GROUP BY 1, 2 ORDER BY 2, 1;"

echo "=== savings actually realised ==="
sudo docker compose exec -T postgres psql -U cinex -d cinex -c "
SELECT p.status, p.budget_cap, p.total_cost, p.current_step
FROM productions p ORDER BY p.created_at DESC LIMIT 1;"
