#!/usr/bin/env bash
# Ship the current working tree to the VM and bring the stack up there.
# Re-run this after every change; it is the whole deploy loop.
#
# Usage:  ./deploy/push.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:-cine-xchange}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-cinexchange}"
REMOTE=/opt/cinexchange
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

say() { printf '\n=== %s ===\n' "$1"; }

[ -f "$ROOT/.env" ] || { echo "no .env at repo root - refusing to deploy without config"; exit 1; }

IP="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --quiet \
      --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
[ -n "$IP" ] || { echo "could not resolve the VM's external IP - is it running?"; exit 1; }
echo "target: $VM ($IP)"

say "building the upload archive"
# tar over ssh rather than `gcloud compute scp --recurse`: scp of a large tree
# is slow and has no exclude flag, and node_modules/.venv/.git together dwarf
# the actual source.
# TMPDIR is forced to a volume with free space (see deploy/env.sh): the
# default on this machine is C:, which is full, and the tarball fails to write.
TMPDIR="${TMPDIR:-/tmp}"
mkdir -p "$TMPDIR"
TARBALL="$(mktemp -p "$TMPDIR" cinex-XXXX.tar.gz)"
tar -czf "$TARBALL" -C "$ROOT" \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.venv' \
  --exclude='./.git' \
  --exclude='./.superpowers' \
  --exclude='./backend' \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  .
echo "archive: $(du -h "$TARBALL" | cut -f1)"

say "uploading"
gcloud compute scp "$TARBALL" "$VM:/tmp/cinex.tar.gz" --zone "$ZONE" --project "$PROJECT" --quiet
rm -f "$TARBALL"

say "unpacking and rewriting host-specific config"
# .env is written for a laptop: DATABASE_URL points at localhost:5433 (the
# host-published port) and FRONTEND_ORIGIN at localhost:3000. Inside compose the
# datastore URLs are already overridden to in-network names, but the browser
# origin and the frontend's view of the API are genuinely host-dependent, so
# they are rewritten here rather than hardcoded in the repo.
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "
  set -euo pipefail
  mkdir -p $REMOTE
  tar -xzf /tmp/cinex.tar.gz -C $REMOTE
  rm -f /tmp/cinex.tar.gz
  cd $REMOTE

  sed -i 's|^FRONTEND_ORIGIN=.*|FRONTEND_ORIGIN=http://$IP:3000|' .env
  grep -q '^NEXT_PUBLIC_API_BASE_URL=' .env \
    && sed -i 's|^NEXT_PUBLIC_API_BASE_URL=.*|NEXT_PUBLIC_API_BASE_URL=http://$IP:8000|' .env \
    || echo 'NEXT_PUBLIC_API_BASE_URL=http://$IP:8000' >> .env

  echo '--- effective host config ---'
  grep -E '^(FRONTEND_ORIGIN|NEXT_PUBLIC_API_BASE_URL|GEMINI_MODEL|GEMINI_USE_VERTEX)=' .env
"

say "building and starting the stack on the VM"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "
  set -euo pipefail
  cd $REMOTE
  sudo docker compose up -d --build
  sudo docker compose ps
"

say "waiting for the orchestrator to answer"
# compose up -d returns as soon as containers are CREATED, not when the app
# inside is serving. Seeding immediately races the first request and fails on a
# connection refused, so poll /healthz first.
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "
  for i in \$(seq 1 60); do
    if curl -sf --max-time 5 localhost:8000/healthz >/dev/null 2>&1; then
      echo \"orchestrator ready after ~\$((i * 5))s\"; exit 0
    fi
    sleep 5
  done
  echo 'orchestrator did not answer within 300s'
  cd /opt/cinexchange && sudo docker compose logs --tail 40 orchestrator
  exit 1
"

say "seeding vendors (idempotent)"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "
  cd $REMOTE && sudo docker compose exec -T orchestrator python -m seeds.seed
"

say "health"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command \
  "curl -s --max-time 20 localhost:8000/healthz | head -c 2000; echo"

cat <<EOF

API:       http://$IP:8000
Health:    http://$IP:8000/healthz
Frontend:  http://$IP:3000

Logs:      gcloud compute ssh $VM --zone $ZONE --command 'cd $REMOTE && sudo docker compose logs -f orchestrator'
Tests:     gcloud compute ssh $VM --zone $ZONE --command 'cd $REMOTE && sudo docker compose exec -T orchestrator python -m pytest -q'
EOF
