#!/usr/bin/env bash
# Interactive Google Cloud sign-in. Run this yourself in a normal terminal -
# it opens a browser and waits for the callback, which an automated session
# cannot do.
#
#   ./deploy/login.sh
#
# Everything else (provision.sh, push.sh) is non-interactive and can be run for
# you afterwards.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/env.sh"

PROJECT="${GCP_PROJECT:-cine-xchange}"

echo "SDK:    $(command -v gcloud)"
echo "config: $CLOUDSDK_CONFIG"
echo

# There are already credentials on this machine for veritas20262026@gmail.com,
# but that account has no permission on cine-xchange - it can only see
# `mandirly` and one other project. Sign in with the account that owns
# cine-xchange (project number 377609708892).
echo "A browser will open. Sign in with the account that OWNS $PROJECT."
echo "If a different account is already offered, switch accounts - the existing"
echo "veritas20262026@gmail.com credentials cannot reach this project."
echo
gcloud auth login

gcloud config set project "$PROJECT"

# Application Default Credentials are separate from the CLI login above, and are
# what the Vertex AI path uses when GEMINI_USE_VERTEX=true. Harmless to set up
# now even if you stay on the API key.
echo
echo "Now setting up Application Default Credentials (a second browser prompt)."
echo "These are what Vertex AI uses if you switch off the API key."
gcloud auth application-default login || {
  echo "ADC step skipped or failed - not fatal, the API-key path still works."
}

echo
echo "=== signed in as ==="
gcloud auth list --format='table(account,status)'
gcloud config list --format='value(core.project)'
echo
echo "Next:  ./deploy/provision.sh   then   ./deploy/push.sh"
