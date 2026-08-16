# Backend Cloud Run (NestJS)

This repo is NestJS, not Express. Use the root `Dockerfile` (Nest) and `.github/workflows/deploy-cloud-run.yml`.

Do **not** create the Cloud Run service in the console with “Continuously deploy from a repository”. GitHub Actions creates `anacorporation-erp-backend` on the first push to `development-anc`.

Backend GitHub repo: `Ana-corporation/Anacorporation-ERP-Backend-`

## What Cloud Run needs

Cloud Run sets `PORT=8080`. The API binds `0.0.0.0` in `src/main.ts`:

```ts
const port = Number(process.env.PORT) || 3002;
await app.listen(port, '0.0.0.0');
```

Binding `localhost` only will fail the Cloud Run startup check.

Health URL after deploy: `https://<service-url>/api/v1/health`

---

## 1) Cloud Shell — Artifact Registry + WIF

Use the **same GCP project and WIF pool** as the frontend.

```bash
# Match the frontend workflow region if yours is different
REGION=asia-southeast1
PROJECT_ID=YOUR_GCP_PROJECT_ID
PROJECT_NUMBER=YOUR_GCP_PROJECT_NUMBER
POOL_ID=YOUR_EXISTING_WIF_POOL_ID
SA_EMAIL=YOUR_EXISTING_WIF_SERVICE_ACCOUNT@${PROJECT_ID}.iam.gserviceaccount.com

gcloud config set project "${PROJECT_ID}"

# Artifact Registry for backend images
gcloud artifacts repositories create anacorporation-erp-backend \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Ana Corporation ERP backend images"
```

If the repo already exists, that command errors — that is fine.

Allow **this** GitHub repo on the existing WIF pool (same SA the frontend already uses):

```bash
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/Ana-corporation/Anacorporation-ERP-Backend-"
```

If the WIF **provider attribute condition** is locked to the frontend repo only, widen it:

```text
attribute.repository=="Ana-corporation/YOUR-FRONTEND-REPO" || attribute.repository=="Ana-corporation/Anacorporation-ERP-Backend-"
```

The service account already used by the frontend also needs:

- `roles/artifactregistry.writer` on `anacorporation-erp-backend`
- `roles/run.admin`
- `roles/iam.serviceAccountUser` on the Cloud Run runtime SA (usually the default compute SA)

```bash
gcloud artifacts repositories add-iam-policy-binding anacorporation-erp-backend \
  --location="${REGION}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"
```

---

## 2) GitHub secrets (backend repo)

Settings → Secrets and variables → Actions.

**Same three GCP secrets as the frontend** (copy the values, do not invent new ones):

| Secret | Example |
|---|---|
| `GCP_PROJECT_ID` | `your-gcp-project` |
| `WIF_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `WIF_SERVICE_ACCOUNT` | `github-actions@PROJECT.iam.gserviceaccount.com` |

**Plus frontend origin:**

| Secret | Value |
|---|---|
| `FRONTEND_ORIGIN` | Live frontend URL, no trailing slash, e.g. `https://anacorporation-erp-xxxxx.asia-southeast1.run.app` |

**Required for this Nest API to boot** (not in the frontend repo):

| Secret | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL (`-pooler`, `sslmode=require`) |
| `DIRECT_DATABASE_URL` | Neon direct URL (no pooler) |
| `JWT_SECRET` | 32+ random characters (same as local `.env` if you want existing sessions) |

---

## 3) Push the backend

```bash
git add Dockerfile .dockerignore .github/workflows/deploy-cloud-run.yml scripts/cloud-run-start.sh
git add src/main.ts src/config/app.config.ts src/config/env.validation.ts
git commit -m "Add Cloud Run NestJS deploy"
git push origin development-anc
```

Actions builds the image, pushes to Artifact Registry `anacorporation-erp-backend`, and creates Cloud Run service `anacorporation-erp-backend`.

Copy the job log line `Backend URL: https://anacorporation-erp-backend-....run.app`.

---

## 4) Point the frontend at this API

In the **frontend** GitHub repo:

1. Set secret `BACKEND_URL` to that Cloud Run URL (no trailing slash).
2. Re-run the frontend workflow.

Frontend calls should use `/api/v1/...` on that host.

---

## Local check

```bash
docker build -t anc-be .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e DATABASE_URL="..." \
  -e DIRECT_DATABASE_URL="..." \
  -e JWT_SECRET="at-least-32-characters-long-secret" \
  -e FRONTEND_ORIGIN="http://localhost:3001" \
  -e K_SERVICE=local \
  anc-be
```

Then open `http://localhost:8080/api/v1/health`.

---

## Notes

- First request can be slow (Cloud Run cold start + Neon). That is expected with `--min-instances 0`.
- Sessions are in-memory until you set `REDIS_HOST`.
- Change `REGION` in `.github/workflows/deploy-cloud-run.yml` if the frontend is not in `asia-southeast1`.
