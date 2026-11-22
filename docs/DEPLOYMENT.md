# Isolated F1 PitWall deployment

## Verified project and current approval boundary

F1 PitWall project: **f1-pitwall-2026-qh719** (number **649091037888**), organization **742095419661**.
Project creation succeeded after `resourcemanager.projects.create` was verified on the organization. Billing was explicitly approved by the user and linked to the existing account ending **37043C**. The dedicated private GCS bucket, image repository, and build/runtime service accounts are created. Both Docker builds and their tests succeeded. The production endpoints are the [Vercel frontend](https://f1-pitwall-anime-recommender.vercel.app/) and the [Cloud Run API](https://f1-pitwall-api-649091037888.us-central1.run.app/docs). The complete project is on `main` following the merge of [PR #1](https://github.com/Seiitsu77/AIPI510-Project3/pull/1), which includes PR #2 and PR #3.

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

Copy the successful build ID from the output. Verify the project again, then deploy the exact image. The production origin is `https://f1-pitwall-anime-recommender.vercel.app` without a trailing slash. The service below is an unauthenticated demo API; do not include private datasets.

```powershell
. ./deploy/verify-project.ps1
gcloud run deploy f1-pitwall-api --image=us-central1-docker.pkg.dev/f1-pitwall-2026-qh719/f1-pitwall/api:SUCCESSFUL_BUILD_ID --region=us-central1 --project=f1-pitwall-2026-qh719 --service-account=f1-pitwall-runtime@f1-pitwall-2026-qh719.iam.gserviceaccount.com --allow-unauthenticated --cpu=1 --memory=1Gi --min-instances=0 --max-instances=1 --concurrency=8 --timeout=60 --update-env-vars='^|^CORS_ORIGINS=https://f1-pitwall-anime-recommender.vercel.app,http://localhost:3000'
gcloud run services describe f1-pitwall-api --region=us-central1 --project=f1-pitwall-2026-qh719 --format='value(status.url)'
```

The custom `.gcloudignore` includes processed datasets and model artifacts while excluding secrets, raw caches, the frontend, and local environments. The Dockerfile only copies explicit code/data directories. Never build a serving image containing untrusted joblib files.

## Deploy Next.js to Vercel

The [production site](https://f1-pitwall-anime-recommender.vercel.app/) is deployed. To reproduce the frontend build on Vercel, use `frontend` as the root directory and the Next.js preset. Set `NEXT_PUBLIC_API_URL=https://f1-pitwall-api-649091037888.us-central1.run.app`. This variable is compiled at build time, so changing it requires a new frontend build. Use `npm ci` and `npm run build`.

The production domain is in the API's `CORS_ORIGINS` allowlist. Add future approved frontend origins to the existing comma-separated list. For an origin-only change, verify the dedicated project and use `gcloud run services update` with `--update-env-vars` on the existing `f1-pitwall-api` service. This deploys a revision from the existing image. Use the Vercel dashboard or authenticated CLI for frontend deployment. Visitors do not need Vercel accounts.

## Verify public integration

```powershell
python scripts/verify_api.py --base-url https://f1-pitwall-api-649091037888.us-central1.run.app --require-ready
curl.exe -i -X OPTIONS 'https://f1-pitwall-api-649091037888.us-central1.run.app/predict' `
  -H 'Origin: https://f1-pitwall-anime-recommender.vercel.app' `
  -H 'Access-Control-Request-Method: POST' `
  -H 'Access-Control-Request-Headers: content-type'
```

Expect HTTP 200 on the production pages and the exact Vercel origin in `Access-Control-Allow-Origin` on the preflight response. Then select the three historical races in a browser and test driver comparison, lap scrubbing and tyre changes. Run Pace Lab and check that `/predict` and `/predict/batch` return the actual model version.

## Verified release and remaining execution limits

- Real dataset: 70 races, 77,373 preserved source laps, 61,041 eligible dry/clean laps. Initial keys `9472`, `9480`, `9488` passed independent raw-to-processed joins and browser Race Control checks.
- Training data was restored from GCS with SHA-256 verification before training. Raw and processed versions, model binary, MLflow database and all experiment artifacts are stored separately in the dedicated bucket; see `docs/evidence/gcs-publication.json`.
- Selected Linear Regression model `e08c75d96518`: held-out MAE 1.718 s / RMSE 2.182 s. Validation selected the estimator; 13 later test races were held out. Full metrics/splits are in `docs/evidence/model-evaluation.json`.
- Current backend Cloud Build: `c8061331-bfb9-4385-90b1-9700395a8826`, successful with 37 Python tests. Image digest: `sha256:5ceba66f97355f5881eac4b47b1010fe7a33770dbf805d6ffb8529576439ca7d`.
- On November 22, 2026, Cloud Run revision `f1-pitwall-api-00004-lt2` added the exact Vercel origin to `CORS_ORIGINS`. The service kept its image digest, runtime service account, existing allowlist entries and other runtime settings. The same image contains dataset `3607cb9ef2c1a44c` and model `e08c75d96518`.
- Both production pages and API documentation returned HTTP 200 without sign-in. `OPTIONS /predict` returned HTTP 200 with `Access-Control-Allow-Origin: https://f1-pitwall-anime-recommender.vercel.app`. The same origin received HTTP 200 from `GET /races`, `GET /model/info`, `POST /predict`, and `POST /predict/batch`. The localhost origin still passed, and an unlisted origin was rejected.
- A browser test selected the 2024 Jeddah race and advanced to lap 33 in Race Control. Pace Lab displayed **1:37.101** for the Sakhir/VER example and returned Medium and Hard tyre estimates for a Jeddah stint scenario. The API reported 70 historical races and a ready model. See `docs/evidence/public-api-verification.json` and `deploy/verification.json` for the original model release evidence.
- GitHub Actions verifies container training and a clean-clone Compose startup on Linux. A Compose run with restored race data and model artifacts on this machine remains unverified.

## Reproduce the cloud-backed training release

```powershell
python -m pipeline.gcs --gcloud-auth --include-raw
python -m pipeline.sync --dataset-version 3607cb9ef2c1a44c --gcloud-auth --training-only
python -m pipeline.train
python -m pipeline.gcs --gcloud-auth --model-only
```

`--gcloud-auth` uses the existing signed-in CLI account in memory; tokens are not printed or saved. All cloud commands verify `f1-pitwall-2026-qh719` / `649091037888`. ADC remains the normal portable SDK option. Model publication rejects a model/dataset version mismatch. The runtime service account needs no GCS write access because the tested deployment image contains the prepared dataset and selected model.
