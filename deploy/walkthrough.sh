#!/usr/bin/env bash
# Full CineXchange walkthrough on the deployed stack, start to finish.
#
# Everything printed is queried from the live system - the agent trace, the
# negotiation rounds, the recovery timeline, the bookings. Nothing is narrated
# from a script or re-stated from a response body; the tables come out of
# Postgres. That is the point: the demo's claim is that the agents did the
# work, so the evidence has to come from where they wrote it.
#
# Run on the VM:  bash walkthrough.sh
set -uo pipefail
cd /opt/cinexchange

API=localhost:8000
jqp() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
psql() { sudo docker compose exec -T postgres psql -U cinex -d cinex "$@"; }
hr()  { printf '\n=== %s ===\n' "$1"; }

TOKEN=$(curl -s -X POST "$API/auth/token" | jqp "['access_token']")
auth=(-H "Authorization: Bearer $TOKEN")

hr "1. THE STACK - 12 containers, 5 MCP agents"
sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}' | head -14
echo
echo "Agent reachability (GET /healthz) - each agent's real MCP tool list:"
curl -s "$API/healthz" | python3 -m json.tool

hr "2. THE BRIEF - unstructured natural language in"
python3 -c "
import json
b=json.load(open('scripts/brief.json'))
print('  budget:', b['budget_cap'], ' location:', b['location'], ' dates:', b['start_date'], '->', b['end_date'])
print()
import textwrap
print(textwrap.fill(b['brief_text'], 96, initial_indent='  \"', subsequent_indent='   '), '\"')
"

hr "3. SUBMIT - one POST, then the agents run alone"
PID=$(curl -s -X POST "$API/productions" "${auth[@]}" -H 'Content-Type: application/json' \
        -d @scripts/brief.json | jqp "['production_id']")
echo "  production_id: $PID"
echo "  the brief is now never resubmitted - everything below flows from this id"

hr "4. LIVE PIPELINE - 10 steps, no human in the loop until the gate"
LAST=""
for i in $(seq 1 150); do
  BODY=$(curl -s "$API/productions/$PID/status" "${auth[@]}")
  ST=$(printf '%s' "$BODY" | jqp "['status']")
  STEP=$(printf '%s' "$BODY" | jqp "['current_step']")
  if [ "$ST/$STEP" != "$LAST" ]; then
    printf '  t+%-4ss  step %-2s  %s\n' "$((i*4))" "$STEP" "$ST"
    LAST="$ST/$STEP"
  fi
  case "$ST" in
    awaiting_approval)
      AID=$(printf '%s' "$BODY" | jqp "['pending_approval_id']")
      echo
      echo "  >> APPROVAL GATE - the one point a human is asked"
      psql -c "SELECT requested_by_agent, reason, threshold_breached, delta_amount
               FROM approvals WHERE id = '$AID';"
      echo "  >> producer approves"
      curl -s -X POST "$API/approvals/$AID/decide" "${auth[@]}" \
           -H 'Content-Type: application/json' -d '{"decision":"approved"}' >/dev/null
      ;;
    booked) echo "  settled: BOOKED at t+$((i*4))s"; break ;;
    failed) echo "  settled: FAILED at t+$((i*4))s"; break ;;
  esac
  sleep 4
done

hr "5. WHAT THE PRODUCER AGENT EXTRACTED - from prose, by LLM"
psql -c "SELECT category, quantity, priority, left(spec::text, 62) AS spec
         FROM requirements WHERE production_id = '$PID' ORDER BY priority, category;"

hr "6. WHAT THE SCOUT FOUND - real quotes from vendor services over HTTP"
psql -c "SELECT v.name AS vendor, o.price, o.status, o.is_winner
         FROM offers o JOIN vendors v ON v.id = o.vendor_id
         JOIN requirements r ON r.id = o.requirement_id
         WHERE r.production_id = '$PID' ORDER BY o.is_winner DESC, o.price DESC LIMIT 12;"

hr "7. THE NEGOTIATION - agent vs vendor, round by round"
echo "The agent cannot see any vendor's reservation price: it lives in a"
echo "different process and is never transmitted. It infers from how they move."
psql -c "SELECT payload->>'vendor_name' AS vendor, payload->>'round' AS rnd,
                payload->>'offered' AS agent_offered, payload->>'decision' AS vendor_said,
                payload->>'vendor_price' AS vendor_countered
         FROM audit_log WHERE action = 'negotiation_round'
           AND entity_id IN (SELECT o.id FROM offers o JOIN requirements r ON r.id=o.requirement_id
                             WHERE r.production_id = '$PID')
         ORDER BY seq LIMIT 14;"

hr "8. COMPLIANCE - rules against MOCK registries, labelled as such"
psql -c "SELECT check_type, status, left(evidence::text, 78) AS evidence
         FROM compliance_checks WHERE production_id = '$PID';"

hr "9. BOOKINGS AND SPEND"
psql -c "SELECT v.name AS vendor, b.final_price, b.status
         FROM bookings b JOIN offers o ON o.id=b.offer_id JOIN vendors v ON v.id=o.vendor_id
         WHERE b.production_id = '$PID' ORDER BY b.final_price DESC;"
psql -c "SELECT status, total_cost, budget_cap,
                round(100.0*total_cost/budget_cap, 1) AS pct_of_budget
         FROM productions WHERE id = '$PID';"

hr "10. THE AUDIT TRAIL - every agent decision, attributed"
psql -c "SELECT actor, count(*) AS decisions FROM audit_log
         WHERE entity_id = '$PID' OR payload->>'production_id' = '$PID'
         GROUP BY actor ORDER BY 2 DESC;"
echo "This is the answer to 'is it scripted?' - each row names the process that"
echo "made the decision, and audit_log is append-only."

echo "$PID" > /tmp/walkthrough_pid
hr "production_id: $PID"
