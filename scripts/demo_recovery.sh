#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}
PID=${1:-$(cat .last_production_id)}

TOKEN=$(curl -s -X POST "$BASE/auth/token" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# take the booked vendor genuinely offline so recovery reacts to a real 503
VENDOR=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/productions/$PID/status" \
  | python -c "import sys,json; print(json.load(sys.stdin)['steps'][-1]['detail'])")
echo "state before: $VENDOR"

curl -s -X POST "$BASE/productions/$PID/recovery" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"trigger":"vendor_unavailable"}' | python -m json.tool
