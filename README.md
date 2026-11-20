# F1 PitWall

A race engineering workspace for exploring historical Formula 1 laps, comparing drivers and tyre stints, and estimating race pace with a reproducible supervised regression pipeline.

**Preview:** https://rushing-amber-691toc5.tmp.now (temporary; expires after one hour unless claimed). **API:** https://f1-pitwall-api-649091037888.us-central1.run.app/docs.

**Current state:** deployed frontend and FastAPI service; synchronized synthetic design fixture; implemented historical ingestion, GCS versioning, training and prediction code. OpenF1 currently restricts historical requests during a live session, so no real race dataset or production model is installed. Predictions and evaluation metrics remain unavailable in the product. The synthetic fixture is explicitly labeled and never used for training.

## Architecture

```text
OpenF1 → validated raw cache → lap/stint/driver/weather joins → versioned processed data
                                      ↓                           ↕ GCS
                       chronological race-group split
                                      ↓
             Linear Regression + HistGradientBoosting → MLflow
                                      ↓
                   versioned preprocessing + model artifact
                                      ↓
                          FastAPI / Cloud Run
                                      ↓
              Next.js Race Control + Pace Lab / Vercel
```

- `frontend/`: Next.js App Router, TypeScript, Tailwind 4, shadcn-style Radix/CVA button, Recharts, Motion and Lucide. `/` is Race Control; `/pace-lab` is the prediction workspace.
- `backend/`: FastAPI, Pydantic input contracts, cached historical replay snapshots, exact serialized preprocessing at inference, explicit supported-input validation and CORS origins.
- `pipeline/`: OpenF1 validation/ingestion, backward weather joins, exclusion flags, GCS uploads/restore, chronological evaluation and MLflow logging.
- `tests/` and `frontend/tests/`: temporal/data integrity, estimator serialization, API, UI synchronization and model-error tests. Synthetic contract fixtures are isolated from product data.
- `deploy/`: dedicated cloud project identity, project verification guard and Cloud Build configuration.

Race Control synchronizes the replay slider, lap number, timing tower, weather, tyre status, chart reference line and stint timeline. Compare up to three drivers, select chart ranges, show/hide flagged laps, click stint segments, use arrow keys, play a lap-by-lap replay and export the compared lap records. A data guide explains source and replay semantics.

Pace Lab accepts circuit, driver/team, compound, tyre age, race lap, track temperature and supported rainfall. It calls `/predict` and `/predict/batch`, shows actual API model versions, renders compound curves and held-out diagnostics, and clears stale predictions when inputs change. Unsupported combinations are unavailable. No hardcoded lap estimates or fake model metrics are presented.

## Local setup (Windows PowerShell)

Requires Python 3.13 and Node.js 24 LTS (or a compatible version supported by the installed Next.js). Use repository-root commands unless noted.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:3000. API docs: http://localhost:8000/docs. With no ingested races, the UI uses the amber **SYNTHETIC UI FIXTURE** mode. If the API cannot be reached, the same source warning remains visible. This is a design preview, not three historical race records. Model outputs remain unavailable until real training completes.

On macOS/Linux use `.venv/bin/python` and `source .venv/bin/activate`. Root `.env` configures Python; `frontend/.env.local` configures the browser API origin. Never commit either file.

## Dataset and ingestion

Source: [OpenF1](https://openf1.org/docs/), an unofficial public Formula 1 data service. The pipeline requests sessions, drivers, laps, stints, weather, positions, intervals, pit events and race-control messages. The initial replay scope is three completed 2024 races at Bahrain, Jeddah and Melbourne; the broader training scope targets completed 2023–2025 races. Availability depends on OpenF1; historical access can be temporarily restricted during live sessions. No live streaming or high-frequency telemetry endpoints are used.

After activating your virtual environment, or replacing `python` with its full venv path:

```powershell
python -m pipeline.ingest --demo
python -m pipeline.preprocess
# Broader training dataset, cached and resumable:
python -m pipeline.ingest --all
python -m pipeline.preprocess
python -m pipeline.train
```

Inspect `data/processed/dataset.json` for counts, exclusions, version and hashes. Raw responses live in `data/raw/<session_key>/`; processed replay JSON and `laps.csv` live in `data/processed/`. Cache reads are validated and do not re-download. `--refresh` explicitly replaces cached endpoint responses; preprocessing verifies session checksums to reject incomplete refreshes. Future/unfinished races are excluded.

Pydantic contracts reflect inspected OpenF1 documentation. Actual success-response inspection and three-race integration remain blocked by the upstream HTTP 401. Review source fields and the [data/model decisions](docs/DATA_MODEL.md) when historical access returns.

## Model training and evaluation

`config.yaml` controls source years/locations/paths, seed, split fractions, minimum races, lap filters, experiment name, model hyperparameters and selection metric. Set `CONFIG_PATH` to use another YAML file.

Target: lap duration in seconds. Features: circuit, driver, team, compound, tyre age at lap start, race lap, track temperature and rainfall. No actual lap/sector results or future events enter the features. Weather is joined backward only, within five minutes. Pit/start/caution/deleted/invalid/wet laps are flagged and excluded as configured; raw observations remain available for replay.

The earliest 60% of race groups train the candidate pipelines, the next 20% select between Linear Regression and HistGradientBoosting, and the latest 20% are a held-out test. At least five real races are required. Both preprocessing and estimator are serialized together. MLflow records parameters, validation errors, final held-out MAE/RMSE, plots, split keys and dataset/model versions. Only the selected model is scored on test races; no refit uses test data.

**Historical MAE and RMSE: not yet available.** The complete training/logging/serialization workflow is exercised with isolated synthetic contract tests; their values are not product evaluation results.

```powershell
python -m pipeline.train
mlflow ui --backend-store-uri sqlite:///mlflow.db --host 127.0.0.1 --port 5000
```

The chosen version is in `artifacts/current.json`; its immutable joblib bundle contains the fitted pipeline and matching model information. The serving process checks the atomic pointer and can load a newly trained version. Only trusted training artifacts belong in this directory. SQLite tracking depends on the pinned SQLAlchemy 2.0 version; the integration tests caught and resolved an incompatibility with SQLAlchemy 2.1.

## Cloud storage and deployment

A separate project has been created: `f1-pitwall-2026-qh719` / `649091037888`. Anime Compass remains in its existing default project. F1 PitWall commands use explicit project IDs and verify identity before deployment. The user approved billing and scoped F1 resources; its dedicated private GCS bucket, image repository, and service accounts are provisioned. Both container builds and tests passed in Cloud Build. The API is deployed publicly; a temporary Vercel preview calls its real origin.

Versioned GCS uploads are opt-in:

```powershell
python -m pipeline.ingest --all --upload
python -m pipeline.preprocess --upload
python -m pipeline.sync --dataset-version EXACT_16_CHARACTER_VERSION
```

Set `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT` and Application Default Credentials locally. No service-account keys are required or committed. Raw and processed datasets occupy separate versioned prefixes. Cloud training can restore an exact processed version with checksum verification.

See [deployment instructions](docs/DEPLOYMENT.md) for the separate project's billing approval boundary, bucket, service accounts, image repository, Cloud Build, Cloud Run, Vercel, CORS and endpoint checks. The public API and temporary frontend are HTTP-verified; actual historical predictions remain unavailable until real data/model artifacts are installed. See `deploy/verification.json`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process health plus explicit data/model readiness |
| `GET /races` | Only actually ingested historical sessions; empty before ingestion |
| `GET /races/{key}/laps` | Preserved observed laps and exclusion flags |
| `GET /races/{key}/stints` | Historical stint records |
| `GET /races/{key}/replay` | Compact shared lap snapshots and analysis data |
| `POST /predict` | One validated estimate plus model/dataset version |
| `POST /predict/batch` | Up to 240 real model estimates for curves |
| `GET /model/info` | Supported inputs, model version, real evaluation information |

`/model/info` and prediction endpoints return HTTP 503 if no trained model exists. Unknown races return 404. Invalid, unsupported or extrapolating prediction inputs return 422. Extra input fields are forbidden. The team must match a trained circuit/driver/team/compound combination.

```powershell
python scripts/verify_api.py
# After actual data/model deployment:
python scripts/verify_api.py --base-url https://YOUR_API_ORIGIN --require-ready
```

Get supported input values and numeric ranges from `/model/info`; submit the eight feature fields as JSON to `/predict`. `/docs` provides interactive request examples and validation schemas.

## Docker

Docker is not installed locally. Both Dockerfiles built successfully in Cloud Build; 22 Python tests, 7 frontend tests and both frontend container HTTP routes passed there. Local compose execution remains unverified.

```powershell
docker compose up --build
# Training/ingestion base image (no preexisting model required):
docker build --target base -t f1-pitwall-pipeline .
docker run --rm --env-file .env -v "${PWD}/data:/app/data" -v "${PWD}/artifacts:/app/artifacts" f1-pitwall-pipeline python -m pipeline.ingest --demo
docker run --rm --env-file .env -v "${PWD}/data:/app/data" -v "${PWD}/artifacts:/app/artifacts" f1-pitwall-pipeline python -m pipeline.preprocess
docker run --rm --env-file .env -v "${PWD}/data:/app/data" -v "${PWD}/artifacts:/app/artifacts" f1-pitwall-pipeline python -m pipeline.train
```

For experiment persistence mount a writable directory and set `MLFLOW_TRACKING_URI` to a SQLite file there, or use an existing authorized MLflow server. GCS uploads in containers require explicitly supplied ADC or workload identity; no credentials are baked into images. Bind mounts must be writable by the non-root container user for training. The frontend API URL is a build argument and must resolve from the **browser**, not the internal Docker network.

## Static preview fallback

The default build remains a standalone Next.js server for Docker and normal Vercel deployment. The optional static export supports the same client-side dashboard/API workflow and avoids Windows builder symlink requirements:

```powershell
cd frontend
# Configure NEXT_PUBLIC_API_URL in .env.local first.
npm run export:static
npx vercel deploy out --temporary --yes
```

The temporary preview must be claimed within one hour to keep it. An authenticated Vercel project remains the permanent deployment path. Do not commit `.vercel` metadata or claim credentials.

## Verification

```powershell
New-Item -ItemType Directory -Path .test-tmp -Force
.\.venv\Scripts\python.exe -m pytest -q --basetemp=.test-tmp/local
cd frontend
npm test
npm run typecheck
npm run build
npm audit
```

The explicit pytest temporary directory avoids an existing Windows temp-folder ACL failure on this machine. Test temp paths and environments are ignored by Git. Frontend tests cover synchronized lap/tyre updates, three-driver limits, session selection, missing models, API prediction calls, stale output clearing and API errors. Python tests cover schema/cache/access restrictions, temporal joins, tyre age, race-group holdouts, replay cutoffs, input validation, CORS, fitted preprocessing, both candidate models and MLflow.

Browser visual QA cannot start because of a desktop sandbox runtime error. Responsive styles are implemented, but desktop/mobile screenshots, actual chart pointer behavior and visual reference matching remain unverified; the attachment supplied text only, without a reference image.

## Collaboration and assignment

See [CONTRIBUTING.md](CONTRIBUTING.md) for suggested teammate ownership and a PR workflow. Each teammate must author and submit at least one real pull request. No GitHub remote or PR history has been created or fabricated.

[STATUS.md](STATUS.md) tracks completed work, remaining tasks and blockers. [Data/model decisions](docs/DATA_MODEL.md) cover exclusions, replay accuracy, ethics and limitations.

## Limitations

Historical downloads and real model evaluation await OpenF1 access. The public deployment currently serves a fixture-based frontend and an API with no historical dataset/model. There are no operational guarantees. Weather/timing records can be incomplete; replay timestamps are approximate; caution filtering is conservative and may discard useful laps. Observational prediction curves do not identify causal tyre effects or driver skill. Fuel, traffic, damage, setup, regulations and strategy are omitted. Use this academic tool for analysis and demonstration, not actual race safety decisions. No affiliation with Formula 1 or FIA is implied.
