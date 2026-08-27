#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}

TOKEN=$(curl -s -X POST "$BASE/auth/token" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
PID=$(curl -s -X POST "$BASE/productions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @scripts/brief.json | python -c "import sys,json; print(json.load(sys.stdin)['production_id'])")

echo "production: $PID"
echo "$PID" > .last_production_id
curl -N "$BASE/productions/$PID/events"
