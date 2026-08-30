"""List the Gemini models this project can actually reach on Vertex AI.

Vertex publisher-model ids differ from the AI Studio ones (the AI Studio name
gemini-3.6-flash resolves to a 404 on Vertex), and there is no gcloud command
that lists them, so ask the SDK directly from inside the deployment.

Run on the VM:
  docker compose exec -T producer-agent python /app/probe-vertex-models.py
"""
import os

from google import genai

project = os.environ.get("GCP_PROJECT", "cine-xchange")
location = os.environ.get("GCP_LOCATION", "us-central1")

print(f"project={project} location={location}")
client = genai.Client(vertexai=True, project=project, location=location)

names = []
try:
    for m in client.models.list():
        name = getattr(m, "name", "") or ""
        actions = getattr(m, "supported_actions", None) or []
        if "gemini" in name.lower():
            names.append((name, list(actions)))
except Exception as exc:  # noqa: BLE001 - this is a diagnostic, report anything
    print(f"list() failed: {type(exc).__name__}: {exc}")

if names:
    print(f"\n{len(names)} gemini models reachable:")
    for name, actions in sorted(names):
        print(f"  {name}   {actions}")
else:
    print("\nlist() returned no gemini models; probing known ids instead")
    candidates = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-flash-latest",
    ]
    for cid in candidates:
        try:
            r = client.models.generate_content(model=cid, contents="say ok")
            text = (r.text or "").strip()[:20]
            print(f"  WORKS  {cid}  -> {text!r}")
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", "?")
            print(f"  fails  {cid}  -> {type(exc).__name__} {code}")
