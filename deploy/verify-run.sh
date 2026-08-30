#!/usr/bin/env bash
# Summarise what the agents actually produced for the most recent production.
# A file, not an inline ssh --command, so quoting is not a hazard.
#
# Run on the VM:  bash verify-run.sh
set -euo pipefail
cd /opt/cinexchange

psql() { sudo docker compose exec -T postgres psql -U cinex -d cinex "$@"; }

echo "=== row counts ==="
psql -c "SELECT
  (SELECT count(*) FROM productions)       AS productions,
  (SELECT count(*) FROM requirements)      AS requirements,
  (SELECT count(*) FROM offers)            AS offers,
  (SELECT count(*) FROM offers WHERE is_winner) AS winners,
  (SELECT count(*) FROM compliance_checks) AS checks,
  (SELECT count(*) FROM approvals)         AS approvals,
  (SELECT count(*) FROM bookings)          AS bookings,
  (SELECT count(*) FROM audit_log)         AS audit_rows;"

echo "=== which agent wrote each audit row ==="
psql -c "SELECT actor, count(*) AS rows FROM audit_log GROUP BY actor ORDER BY 2 DESC;"

echo "=== requirements the producer agent extracted ==="
psql -c "SELECT category, quantity, priority FROM requirements ORDER BY priority, category;"

echo "=== negotiation rounds actually exchanged with vendors ==="
psql -c "SELECT
  payload->>'vendor_name'  AS vendor,
  payload->>'round'        AS rnd,
  payload->>'offered'      AS agent_offered,
  payload->>'decision'     AS vendor_said,
  payload->>'vendor_price' AS vendor_price
 FROM audit_log WHERE action = 'negotiation_round' ORDER BY seq LIMIT 10;"

echo "=== the approval gate that fired ==="
psql -c "SELECT requested_by_agent, reason, threshold_breached, delta_amount, producer_decision
         FROM approvals ORDER BY created_at DESC LIMIT 3;"

echo "=== cost vs cap ==="
psql -c "SELECT status, budget_cap, total_cost, current_step FROM productions ORDER BY created_at DESC LIMIT 3;"

echo "=== why do vendors accept in round 1? agent offer vs vendor floor ==="
# The vendor accepts as soon as offer >= base_price * floor_pct (0.72-0.88).
# If the agent's opening number is already near the full quote, it never haggles.
psql -c "SELECT v.name,
                v.base_price                                   AS base,
                round(v.base_price * 0.72, 2)                  AS lowest_possible_floor,
                round(v.base_price * 0.88, 2)                  AS highest_possible_floor,
                (a.payload->>'offered')::numeric               AS agent_offered,
                a.payload->>'decision'                         AS vendor_said
         FROM audit_log a
         JOIN vendors v ON v.id = (a.payload->>'vendor_id')::uuid
         WHERE a.action = 'negotiation_round'
         ORDER BY a.seq LIMIT 8;"
