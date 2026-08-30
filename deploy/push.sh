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
  --exclude='./.pytest_cache' \
  --exclude='./backend' \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  .
echo "archive: $(du -h "$TARBALL" | cut -f1)"

say "uploading"
gcloud compute scp "$TARBALL" "$VM:/tmp/cinex.tar.gz" --zone "$ZONE" --project "$PROJECT" --quiet
rm -f "$TARBALL"

say "uploading the remote deploy script"
# The remote half of the deploy is a FILE, not an inline --command string.
# Inline scripts are expanded by the LOCAL shell before gcloud ever sees them,
# so every $(...) resolves on the wrong machine and a stray parenthesis - even
# inside a comment - breaks gcloud argument parsing. Three deploy failures came
# from exactly that.
gcloud compute scp "$HERE/remote-deploy.sh" "$VM:/tmp/remote-deploy.sh"   --zone "$ZONE" --project "$PROJECT" --quiet

say "deploying on the VM"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet   --command "bash /tmp/remote-deploy.sh $IP"

cat <<EOF

API:       http://$IP:8000
Health:    http://$IP:8000/healthz
Frontend:  http://$IP:3000

Logs:      gcloud compute ssh $VM --zone $ZONE --command 'cd $REMOTE && sudo docker compose logs -f orchestrator'
Tests:     gcloud compute ssh $VM --zone $ZONE --command 'cd $REMOTE && sudo docker compose exec -T orchestrator python -m pytest -q'
EOF
