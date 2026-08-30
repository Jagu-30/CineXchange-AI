#!/usr/bin/env bash
# Drive the emergency-recovery scenario end to end on the deployed stack.
#
# The vendor is taken genuinely offline via /admin/vendors/{id}/disable, so the
# scout's next call gets a real 503 and the recovery agent reacts to an actual
# outage rather than to a flag we set for its benefit. That distinction is the
# whole point of the demo beat.
#
# Run on the VM:  bash run-recovery.sh
set -euo pipefail
cd /opt/cinexchange

API=localhost:8000
jqp() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
psql() { sudo docker compose exec -T postgres psql -U cinex -d cinex "$@"; }

TOKEN=$(curl -s -X POST "$API/auth/token" | jqp "['access_token']")
auth=(-H "Authorization: Bearer $TOKEN")

echo "=== 1. a production, run to a booked state ==="
PID=$(curl -s -X POST "$API/productions" "${auth[@]}" -H 'Content-Type: application/json' \
        -d @scripts/brief.json | jqp "['production_id']")
echo "production: $PID"

for i in $(seq 1 48); do
  BODY=$(curl -s "$API/productions/$PID/status" "${auth[@]}")
  ST=$(printf '%s' "$BODY" | jqp "['status']")
  case "$ST" in
    awaiting_approval)
      AID=$(printf '%s' "$BODY" | jqp "['pending_approval_id']")
      echo "  approval gate at t+$((i*5))s - approving to reach a booking"
      curl -s -X POST "$API/approvals/$AID/decide" "${auth[@]}" \
        -H 'Content-Type: application/json' -d '{"decision":"approved"}' >/dev/null
      ;;
    booked) echo "  booked at t+$((i*5))s"; break ;;
    failed) echo "  FAILED at t+$((i*5))s"; exit 1 ;;
  esac
  sleep 5
done

echo
echo "=== 2. the booking we are about to break ==="
psql -c "SELECT b.id AS booking_id, v.name AS vendor, b.final_price, b.status
         FROM bookings b JOIN offers o ON o.id = b.offer_id JOIN vendors v ON v.id = o.vendor_id
         WHERE b.production_id = '$PID' AND b.status = 'confirmed'
         ORDER BY b.final_price DESC LIMIT 3;"

VENDOR_ID=$(psql -t -A -c "SELECT o.vendor_id FROM bookings b JOIN offers o ON o.id = b.offer_id
                           WHERE b.production_id = '$PID' AND b.status = 'confirmed'
                           ORDER BY b.final_price DESC LIMIT 1;")
ENDPOINT=$(psql -t -A -c "SELECT contact_meta->>'endpoint' FROM vendors WHERE id = '$VENDOR_ID';")
VENDOR_NAME=$(psql -t -A -c "SELECT name FROM vendors WHERE id = '$VENDOR_ID';")

echo
echo "=== 3. taking $VENDOR_NAME genuinely offline ==="
sudo docker compose exec -T orchestrator python -c "
import httpx
r = httpx.post('$ENDPOINT/admin/vendors/$VENDOR_ID/disable', timeout=10)
print('  disable ->', r.status_code, r.text[:80])
q = httpx.get('$ENDPOINT/vendors/$VENDOR_ID/quote',
              params={'category':'camera','quantity':1,'base_price':'1000.00',
                      'start':'2026-09-01','end':'2026-09-03'}, timeout=10)
print('  quote now ->', q.status_code, '(503 means it is really down)')
"

echo
echo "=== 4. triggering recovery ==="
curl -s -X POST "$API/productions/$PID/recovery" "${auth[@]}" \
     -H 'Content-Type: application/json' -d '{"trigger":"vendor_unavailable"}' \
  | python3 -m json.tool | head -60

echo
echo "=== 5. the 7-step timeline as persisted ==="
psql -c "SELECT jsonb_array_length(timeline) AS steps, status, trigger
         FROM recovery_events WHERE production_id = '$PID';"
psql -c "SELECT e->>'step' AS step, e->>'name' AS name,
                left((e->'detail')::text, 90) AS detail
         FROM recovery_events r, jsonb_array_elements(r.timeline) e
         WHERE r.production_id = '$PID' ORDER BY (e->>'step')::int;"

echo
echo "=== 6. old vs new booking ==="
psql -c "SELECT b.status, v.name AS vendor, b.final_price
         FROM bookings b JOIN offers o ON o.id = b.offer_id JOIN vendors v ON v.id = o.vendor_id
         WHERE b.production_id = '$PID' ORDER BY b.status, b.final_price DESC;"

echo "production_id: $PID"
