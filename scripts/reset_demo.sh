#!/usr/bin/env bash
# Reset the demo: clear every transactional table, re-enable every vendor on
# every vendor-mock instance, and drop the last production id cache - without
# touching `vendors`, so no re-seed is needed between rehearsals.
#
# Run from the repo root, with the compose stack up:
#   ./scripts/reset_demo.sh
#
# Uses `uv run python` rather than bare `python` - on this machine a bare
# `python` on PATH resolves to the Windows Store's broken app-execution alias.
set -euo pipefail

docker compose exec -T postgres psql -U cinex -d cinex <<'SQL'
TRUNCATE audit_log, recovery_events, approvals, compliance_checks,
         bookings, offers, requirements, productions CASCADE;
SQL

for port in 9001 9002 9003; do
  for vendor in $(uv run python -c "
import json
print(' '.join(v['id'] for v in json.load(open('seeds/vendors.json'))))
"); do
    curl -s -X POST "http://localhost:$port/admin/vendors/$vendor/enable" > /dev/null || true
  done
done

rm -f .last_production_id
echo "demo reset - vendors re-enabled, transactional tables cleared, seeds intact"
