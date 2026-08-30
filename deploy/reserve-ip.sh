#!/usr/bin/env bash
# Promote the VM's ephemeral external IP to a reserved static one, so the demo
# URL survives a stop/start. Idempotent.
#
# Usage:  ./deploy/reserve-ip.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:-cine-xchange}"
ZONE="${GCP_ZONE:-us-central1-a}"
REGION="${GCP_REGION:-us-central1}"
VM="${VM_NAME:-cinexchange}"
ADDR="${ADDR_NAME:-cinex-ip}"

say() { printf '\n=== %s ===\n' "$1"; }

CURRENT="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --quiet \
           --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "current IP: $CURRENT"

say "reserving"
if gcloud compute addresses describe "$ADDR" --region "$REGION" --project "$PROJECT" --quiet >/dev/null 2>&1; then
  echo "address $ADDR already reserved"
else
  # Promote the address the VM already holds rather than allocating a new one:
  # keeping the same IP means the frontend bundle, which has the API base baked
  # in at build time, does not have to be rebuilt.
  gcloud compute addresses create "$ADDR" \
    --region "$REGION" --project "$PROJECT" --quiet \
    --addresses "$CURRENT" 2>/dev/null \
    || gcloud compute addresses create "$ADDR" --region "$REGION" --project "$PROJECT" --quiet
fi

STATIC="$(gcloud compute addresses describe "$ADDR" --region "$REGION" --project "$PROJECT" \
          --quiet --format='get(address)')"
echo "reserved: $STATIC"

if [ "$STATIC" = "$CURRENT" ]; then
  say "done"
  echo "The VM already holds $STATIC and it is now reserved. No rebuild needed."
else
  say "reattaching the VM to the reserved address"
  IFACE="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --quiet \
           --format='get(networkInterfaces[0].name)')"
  CFG="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --quiet \
         --format='get(networkInterfaces[0].accessConfigs[0].name)')"
  gcloud compute instances delete-access-config "$VM" \
    --zone "$ZONE" --project "$PROJECT" --quiet \
    --access-config-name "$CFG" --network-interface "$IFACE"
  gcloud compute instances add-access-config "$VM" \
    --zone "$ZONE" --project "$PROJECT" --quiet \
    --access-config-name "$CFG" --network-interface "$IFACE" --address "$STATIC"
  say "IP CHANGED - the frontend must be rebuilt"
  echo "NEXT_PUBLIC_API_BASE_URL is inlined into the client bundle at build time,"
  echo "so run ./deploy/push.sh before using the UI."
fi

echo
echo "UI:   http://$STATIC:3000"
echo "API:  http://$STATIC:8000"
