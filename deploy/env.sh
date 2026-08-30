# Source this before running the deploy scripts:  . deploy/env.sh
#
# The Cloud SDK lives on D: because C: is full. gcloud also writes its config,
# credentials and logs to CLOUDSDK_CONFIG (default %APPDATA%\gcloud, also on C:),
# so that is redirected too - otherwise every command dies in the logging
# handler before it does any work.
export CLOUDSDK_PYTHON="D:/tools/google-cloud-sdk/platform/bundledpython/python.exe"
export CLOUDSDK_CONFIG="D:/tools/gcloud-config"
export PATH="/d/tools/google-cloud-sdk/bin:$PATH"

# tar, docker and friends default TMPDIR to C:. With no free space there, the
# deploy tarball fails to write. D: has room.
export TMPDIR="/d/tmp"
mkdir -p "$TMPDIR" "$CLOUDSDK_CONFIG"
