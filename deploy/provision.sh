#!/usr/bin/env bash
# Provision the CineXchange VM on Google Cloud. Idempotent: safe to re-run.
#
# Prerequisites you must do yourself (they need a browser, this script cannot):
#   gcloud auth login
#   gcloud config set project cine-xchange
#
# Usage:  ./deploy/provision.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:-cine-xchange}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-cinexchange}"
# e2-standard-2 (8 GB), not e2-medium (4 GB): the VM builds the Next.js
# image and then runs 12 containers. A 4 GB box OOMs during `next build`.
MACHINE="${VM_MACHINE:-e2-standard-2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n=== %s ===\n' "$1"; }

say "project / account"
gcloud config set project "$PROJECT" >/dev/null
gcloud config list --format='value(core.account,core.project)'

say "enabling APIs (no-op if already on)"
gcloud services enable compute.googleapis.com aiplatform.googleapis.com --project "$PROJECT" --quiet

say "firewall"
# Orchestrator API and the Next.js frontend. Deliberately NOT opening 5432 or
# 8123: Postgres and ClickHouse stay inside the VM's docker network, reachable
# only by the app containers. Exposing a database to the internet for a demo is
# not a trade worth making.
if ! gcloud compute firewall-rules describe cinex-allow-app --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create cinex-allow-app \
    --project "$PROJECT" --quiet \
    --allow=tcp:8000,tcp:3000 \
    --target-tags=cinexchange \
    --description="CineXchange orchestrator API (8000) and frontend (3000)"
else
  echo "firewall rule cinex-allow-app already exists"
fi

say "VM"
if gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1; then
  echo "instance $VM already exists"
  gcloud compute instances start "$VM" --zone "$ZONE" --project "$PROJECT" --quiet 2>/dev/null || true
else
  gcloud compute instances create "$VM" \
    --project "$PROJECT" --quiet \
    --zone "$ZONE" \
    --machine-type "$MACHINE" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=40GB \
    --boot-disk-type=pd-balanced \
    --tags=cinexchange \
    --scopes=cloud-platform \
    --metadata-from-file=startup-script="$HERE/vm-startup.sh"
fi

IP="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" \
      --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

say "waiting for the startup script to finish installing docker"
# The instance answers ssh well before docker exists; polling for the sentinel
# the startup script writes avoids a deploy that fails on a missing binary.
for i in $(seq 1 60); do
  if gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet \
       --command 'test -f /var/log/cinex-startup-done' >/dev/null 2>&1; then
    echo "docker ready after ~$((i * 10))s"
    break
  fi
  [ "$i" -eq 60 ] && { echo "timed out waiting for startup script"; exit 1; }
  sleep 10
done

say "done"
cat <<EOF
VM:        $VM  ($MACHINE, $ZONE)
External:  $IP
API:       http://$IP:8000
Frontend:  http://$IP:3000

Next:  ./deploy/push.sh
EOF
