#!/usr/bin/env bash
# Runs ON THE VM. Uploaded by push.sh and executed there.
#
# This lives in a file rather than inside `gcloud compute ssh --command "..."`
# on purpose. That form passes the script through the LOCAL shell first, so
# every $(...) expands on the wrong machine and any stray parenthesis - even
# inside a comment - breaks gcloud's own argument parsing. Three separate
# deploy failures came from exactly that before this file existed.
#
# Usage (on the VM):  bash remote-deploy.sh <EXTERNAL_IP>
set -euo pipefail

IP="${1:?usage: remote-deploy.sh <EXTERNAL_IP>}"
REMOTE=/opt/cinexchange
TARBALL=/tmp/cinex.tar.gz

say() { printf '\n--- %s ---\n' "$1"; }

say "unpacking"
# Wipe and recreate. The target is fully replaced on every deploy, and a
# half-extracted tree from a failed run leaves root-owned files the login user
# cannot overwrite.
sudo rm -rf "$REMOTE"
sudo mkdir -p "$REMOTE"
sudo chown -R "$(id -u):$(id -g)" "$REMOTE"
tar -xzf "$TARBALL" -C "$REMOTE" --no-same-owner --no-overwrite-dir
rm -f "$TARBALL"
cd "$REMOTE"

say "rewriting host-specific config"
# .env is written for a laptop. The datastore URLs are already overridden by
# docker-compose to in-network names, but these two are genuinely host-dependent:
#   FRONTEND_ORIGIN         - the CORS allow-list entry for the real browser origin
#   NEXT_PUBLIC_API_BASE_URL - inlined into the client bundle at BUILD time, so it
#                              must be right before the image is built, not after
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
set_env FRONTEND_ORIGIN "http://${IP}:3000"
set_env NEXT_PUBLIC_API_BASE_URL "http://${IP}:8000"
grep -E '^(FRONTEND_ORIGIN|NEXT_PUBLIC_API_BASE_URL|GEMINI_MODEL|GEMINI_USE_VERTEX)=' .env

say "building and starting the stack"
sudo docker compose up -d --build
sudo docker compose ps

say "waiting for the orchestrator to answer"
# `compose up -d` returns when containers are CREATED, not when the app inside
# is serving, so seeding immediately would race the first request.
ready=0
for _ in $(seq 1 60); do
  if curl -sf --max-time 5 localhost:8000/healthz >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo "orchestrator did not answer within 300s"
  sudo docker compose logs --tail 60 orchestrator
  exit 1
fi
echo "orchestrator is up"

say "seeding vendors (idempotent)"
sudo docker compose exec -T orchestrator python -m seeds.seed

say "health"
curl -s --max-time 20 localhost:8000/healthz
echo
