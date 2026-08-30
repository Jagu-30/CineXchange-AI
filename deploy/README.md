# Deploying CineXchange to Google Cloud

One Compute Engine VM running the existing `docker-compose.yml`. Chosen over
Cloud Run and GKE because the five agents address each other by in-network DNS
name (`http://scout-agent:8002/mcp`), which a single Docker network preserves
with **zero code changes**. Cloud Run would have required rewriting those five
URLs to public HTTPS endpoints and moving Postgres to Cloud SQL.

Docker runs on the VM, never on your laptop.

## One-time

You must do this part yourself — it needs a browser:

```bash
gcloud auth login
gcloud config set project cine-xchange
```

Then:

```bash
./deploy/provision.sh
```

Creates the firewall rule and the VM, and waits for Docker to finish
installing. Idempotent — safe to re-run.

## Every deploy

```bash
./deploy/push.sh
```

Tars the working tree (minus `node_modules`, `.venv`, `.git`, `backend/`),
uploads it, rewrites the host-dependent config, rebuilds, and seeds vendors.

## What is exposed

| Port | Service |
|------|---------|
| 8000 | orchestrator API |
| 3000 | Next.js frontend |

Postgres (5432) and ClickHouse (8123) are deliberately **not** opened. They stay
on the VM's internal Docker network, reachable only by the app containers.

## Configuration

`.env` travels with the upload and is rewritten on the VM for two
host-dependent values:

- `FRONTEND_ORIGIN` — the CORS allow-list origin, becomes `http://<vm-ip>:3000`
- `NEXT_PUBLIC_API_BASE_URL` — baked into the client bundle at build time,
  becomes `http://<vm-ip>:8000`

`DATABASE_URL` and `CLICKHOUSE_URL` need no rewrite: `docker-compose.yml`
already overrides them with in-network service names.

## Vertex AI

For a hosted deployment, prefer the service account over an API key:

```bash
gcloud services enable aiplatform.googleapis.com --project=cine-xchange
```

then set `GEMINI_USE_VERTEX=true` in `.env`. The VM is created with
`--scopes=cloud-platform`, so the attached service account supplies credentials
and no key ships in the image.
