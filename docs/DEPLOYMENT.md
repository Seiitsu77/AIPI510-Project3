# Isolated F1 PitWall deployment

## Verified project and current approval boundary

F1 PitWall project: **f1-pitwall-2026-qh719** (number **649091037888**), organization **742095419661**.
Project creation succeeded after `resourcemanager.projects.create` was verified on the organization. Billing was explicitly approved by the user and linked to the existing account ending **37043C**. The dedicated private GCS bucket, image repository, and build/runtime service accounts are created. Both Docker builds and their tests succeeded. The API is deployed at https://f1-pitwall-api-649091037888.us-central1.run.app. The verified temporary Vercel frontend has expired.

The existing default project `project-4ea00490-f490-4348-86b` belongs to Anime Compass. Do not deploy there, change its IAM, change its resources, or change the default gcloud project. Every command below names the dedicated project. Verify its ID and number immediately before each deployment operation with `deploy/verify-project.ps1`.

**The user approved billing and the scoped F1 resources.** The commands below document the reproducible setup; creation commands have already run for the resources listed above and should not be blindly repeated. Proposed billing account: the existing open account ending **37043C**. Linking billing allows charges; GCS, builds, image storage, network transfer, and requests may incur cost even with Cloud Run minimum instances at zero. Budget alerts are notifications, not spending caps.

## Prerequisites for the historical/model-ready release

The real dataset and selected fitted model are prepared and verified. The current release uses dataset `3607cb9ef2c1a44c`, model `e08c75d96518`, and the 70 completed 2023–2025 race collection. Repeat these gates before a new historical/model release.

1. Confirm historical OpenF1 access. Initial live-session HTTP 401 restrictions have cleared; the full collection was downloaded successfully. Future restrictions require waiting or an already authorized token, never a bypass.
2. Ingest and preprocess real data; train on at least five races (preferably the configured 2023–2025 collection).
3. Run all checks and ensure `artifacts/current.json`, its versioned model, and `data/processed/races.json` exist.
4. Preserve the approved resource scope. Additional unrelated services are not authorized.
5. Authenticate gcloud and Docker, or use Cloud Build. Do not create/download service-account keys.

## Enable billing — only after approval

Run from the repository root in PowerShell. Replace the billing placeholder with the approved account ID.

```powershell
. ./deploy/verify-project.ps1
gcloud billing projects link f1-pitwall-2026-qh719 --billing-account=APPROVED_BILLING_ACCOUNT --project=f1-pitwall-2026-qh719
gcloud billing projects describe f1-pitwall-2026-qh719 --project=f1-pitwall-2026-qh719 --format='json(projectId,billingEnabled)'
```

## Prepare dedicated resources — only after approval

```powershell
. ./deploy/verify-project.ps1
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com iam.googleapis.com --project=f1-pitwall-2026-qh719
gcloud storage buckets create gs://f1-pitwall-2026-qh719-data --project=f1-pitwall-2026-qh719 --location=us-central1 --uniform-bucket-level-access --public-access-prevention
gcloud artifacts repositories create f1-pitwall --repository-format=docker --location=us-central1 --project=f1-pitwall-2026-qh719
gcloud iam service-accounts create f1-pitwall-runtime --display-name='F1 PitWall API runtime' --project=f1-pitwall-2026-qh719
gcloud iam service-accounts create f1-pitwall-build --display-name='F1 PitWall isolated build account' --project=f1-pitwall-2026-qh719
```

The runtime image contains prepared processed records and the trusted versioned model; it does not need GCS write access or a project-wide role. The local ingestion identity needs `roles/storage.objectCreator` on this bucket for uploads, and `roles/storage.objectViewer` if restoring datasets. Grant these on the **F1 PitWall bucket only**, using your approved identity, never on Anime Compass resources. A managed training job should have a separate training account with only bucket-level access. The dedicated `f1-pitwall-build` account has Artifact Registry writer on only this repository, Storage object viewer on only this bucket, and project-level Logs writer. The build stages source under this bucket’s `build-source/` prefix. No service-account keys were created.

## Publish versioned real data to GCS

Set `GCS_BUCKET=f1-pitwall-2026-qh719-data` and `GOOGLE_CLOUD_PROJECT=f1-pitwall-2026-qh719` in root `.env`. For local SDK credentials use `gcloud auth application-default login` and ensure the quota project, if requested, is the F1 PitWall project. Do not put credential JSON in the repository.

```powershell
python -m pipeline.ingest --all --upload
python -m pipeline.preprocess --upload
# On another authorized machine, restore an exact processed version:
python -m pipeline.sync --dataset-version DATASET_VERSION_FROM_MANIFEST
python -m pipeline.train
```

Raw and processed objects use separate versioned prefixes. The processed manifest records raw hashes and a cleaned CSV hash. Raw API caches are never downloaded during dashboard interactions. Models are packaged in the image; retain MLflow artifacts separately if you need durable experiment history.

## Build and deploy FastAPI

```powershell
. ./deploy/verify-project.ps1
gcloud builds submit . --config=deploy/cloudbuild.yaml --project=f1-pitwall-2026-qh719 --region=us-central1 --substitutions=_REGION=us-central1 --service-account=projects/f1-pitwall-2026-qh719/serviceAccounts/f1-pitwall-build@f1-pitwall-2026-qh719.iam.gserviceaccount.com --gcs-source-staging-dir=gs://f1-pitwall-2026-qh719-data/build-source
```

Copy the successful build ID from the output. Verify the project again, then deploy the exact image. Replace `FRONTEND_ORIGIN` with the exact HTTPS origin (no trailing slash) of the Vercel deployment. The service below is an unauthenticated demo API; do not include private datasets.

```powershell
. ./deploy/verify-project.ps1
gcloud run deploy f1-pitwall-api --image=us-central1-docker.pkg.dev/f1-pitwall-2026-qh719/f1-pitwall/api:SUCCESSFUL_BUILD_ID --region=us-central1 --project=f1-pitwall-2026-qh719 --service-account=f1-pitwall-runtime@f1-pitwall-2026-qh719.iam.gserviceaccount.com --allow-unauthenticated --cpu=1 --memory=1Gi --min-instances=0 --max-instances=1 --concurrency=8 --timeout=60 --set-env-vars=CORS_ORIGINS=FRONTEND_ORIGIN
gcloud run services describe f1-pitwall-api --region=us-central1 --project=f1-pitwall-2026-qh719 --format='value(status.url)'
```

The custom `.gcloudignore` includes processed datasets and model artifacts while excluding secrets, raw caches, the frontend, and local environments. The Dockerfile only copies explicit code/data directories. Never build a serving image containing untrusted joblib files.

## Deploy Next.js to Vercel

No Vercel authentication was found during implementation. Create/import a repository using your GitHub account, choose `frontend` as the Vercel root directory and the Next.js preset, and set `NEXT_PUBLIC_API_URL` to the Cloud Run HTTPS origin. This variable is compiled at build time, so changing it requires a new frontend build. Use `npm ci` and `npm run build`.

Set the API `CORS_ORIGINS` to that exact Vercel origin. Preview deployments have distinct origins; add explicitly approved origins as a comma-separated list rather than enabling `*`. Vercel CLI is an alternative after `vercel login`; run it inside `frontend`. Do not claim a deployment until public endpoints pass the following checks.

## Verify public integration

```powershell
python scripts/verify_api.py --base-url https://YOUR_CLOUD_RUN_ORIGIN --require-ready
```

Verify frontend HTTP 200, then in a working browser select all three historical races; compare drivers, scrub laps, inspect tyre changes and the chart tooltip, and run Pace Lab. Confirm `/predict` and `/predict/batch` use the public Cloud Run API and show its actual model version. Test both supported and unsupported inputs. Validate CORS using the Vercel Origin header.

## Verified release and remaining execution limits

- Real dataset: 70 races, 77,373 preserved source laps, 61,041 eligible dry/clean laps. Initial keys `9472`, `9480`, `9488` passed independent raw-to-processed joins and browser Race Control checks.
- Training data was restored from GCS with SHA-256 verification before training. Raw and processed versions, model binary, MLflow database and all experiment artifacts are stored separately in the dedicated bucket; see `docs/evidence/gcs-publication.json`.
- Selected Linear Regression model `e08c75d96518`: held-out MAE 1.718 s / RMSE 2.182 s. Validation selected the estimator; 13 later test races were held out. Full metrics/splits are in `docs/evidence/model-evaluation.json`.
- Current backend Cloud Build: `c8061331-bfb9-4385-90b1-9700395a8826`, successful with 37 Python tests. Image digest: `sha256:5ceba66f97355f5881eac4b47b1010fe7a33770dbf805d6ffb8529576439ca7d`.
- The frontend is a static-only Next.js export: no raw/processed datasets, fitted models, MLflow database or credentials are uploaded to Vercel. Audited payload: 29 generated HTML/JS/CSS/page files, approximately 1.25 MB. It calls the existing public API for observed/model responses.
- The first temporary preview expired after one hour. For a persistent deployment, sign into Vercel, deploy the frontend and configure its exact final origin in API CORS.
- Cloud Run revision `f1-pitwall-api-00003-6kw` serves the actual dataset and model; public single/batch predictions and all three focus replays passed. Browser checks confirmed the live Pace Lab estimate, curves, historical references and held-out metrics at desktop/mobile sizes. See `docs/evidence/public-api-verification.json` and `deploy/verification.json`.
- Local Docker/compose remain unavailable; container builds/tests are verified via Cloud Build.

## Reproduce the cloud-backed training release

```powershell
python -m pipeline.gcs --gcloud-auth --include-raw
python -m pipeline.sync --dataset-version 3607cb9ef2c1a44c --gcloud-auth --training-only
python -m pipeline.train
python -m pipeline.gcs --gcloud-auth --model-only
```

`--gcloud-auth` uses the existing signed-in CLI account in memory; tokens are not printed or saved. All cloud commands verify `f1-pitwall-2026-qh719` / `649091037888`. ADC remains the normal portable SDK option. Model publication rejects a model/dataset version mismatch. The runtime service account needs no GCS write access because the tested deployment image contains the prepared dataset and selected model.

The temporary frontend uses `npm run export:static`, then `vercel deploy out --temporary --yes`. This avoids the Windows anonymous Next.js builder's symlink requirement without weakening system permissions. After claiming, rebuild only if the API origin changes; update CORS if the frontend origin changes.
