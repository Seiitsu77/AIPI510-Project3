# F1 PitWall

A race engineering dashboard for **real historical Formula 1 records**, driver/tyre comparisons, and reproducible lap-pace estimation. Next.js/TypeScript serves Race Control and Pace Lab; FastAPI serves cached OpenF1 data and the fitted scikit-learn pipeline.

- API: [Cloud Run documentation](https://f1-pitwall-api-649091037888.us-central1.run.app/docs).
- Frontend: [Vercel preview](https://brisk-lagoon-o8ed8dn.tmp.now). Anonymous previews expire after one hour unless claimed; the private claim link is supplied in chat, never committed.
- Review: [PR #1](https://github.com/Seiitsu77/AIPI510-Project3/pull/1), branch `feat/f1-pitwall-platform`. `main` intentionally stays empty until review/merge.

## Real data and model results

The versioned OpenF1 dataset contains **70 completed 2023–2025 races**, **77,373 observed laps**, and **61,041 eligible dry/clean laps**. The initial complete replay sessions are:

| Race | Session key | Observed laps | Stints | Weather observations |
| --- | --- | --- | --- | --- |
| Bahrain 2024 / Sakhir | 9472 | 1,129 | 63 | 157 |
| Saudi Arabia 2024 / Jeddah | 9480 | 902 | 39 | 146 |
| Australia 2024 / Melbourne | 9488 | 998 | 55 | 144 |

All three preserve lap grain, have no duplicate driver/lap keys or internal lap-number gaps, and have no overlapping stint matches or future-weather joins. Source retirement/null records remain visible and ineligible for training. Other historical sessions can have missing source laps or overlapping source stints; these are flagged, never filled with synthetic records. See the [three-race audit](docs/evidence/data-quality.json) and [full audit](docs/evidence/all-data-quality.json).

A chronological race-group split uses 43 training, 13 validation and 13 test races. One of the 70 source races has no eligible dry laps and does not enter the split. No test race is used for fitting or model selection.

| Candidate | Validation MAE (s) | Validation RMSE (s) |
| --- | --- | --- |
| **Linear Regression — selected** | **1.729** | **2.391** |
| HistGradientBoosting | 2.265 | 3.335 |

The selected model's held-out test results are **MAE 1.718 s** and **RMSE 2.182 s**, across **11,540 eligible laps in 13 races**. These describe filtered historical observations, not arbitrary laps, causal tyre degradation, or race-result guarantees.

- Dataset version: `3607cb9ef2c1a44c`.
- Model version: `e08c75d96518`.
- MLflow run: `ba7dd85da4324047857ffd46093ad68a`.
- Full metrics, split keys, per-race errors, source checksum and example input: [model evaluation](docs/evidence/model-evaluation.json).
- Actual cloud data/model locations and checksum verification: [GCS publication receipt](docs/evidence/gcs-publication.json).

## Architecture

```text
OpenF1 → validated raw cache → lap/stint/driver/backward-weather joins
                                      ↓
                  versioned GCS dataset + checksum-verified restore
                                      ↓
       chronological train / validation / test split → LR + HGB → MLflow
                                      ↓
              fitted preprocessing + selected model + atomic version pointer
                                      ↓
                       FastAPI / Google Cloud Run
                                      ↓
               Next.js Race Control + Pace Lab / Vercel
```

`frontend/` contains the synchronized dashboard, Recharts charts, Motion transitions, Tailwind styles and Radix/CVA UI components. `backend/` contains Pydantic request validation, replay/reference endpoints and exact fitted preprocessing at inference. `pipeline/` contains source contracts, resumable ingestion, preprocessing, data audits, GCS operations and training. `tests/` includes recorded real-response samples as well as isolated synthetic unit fixtures. Raw datasets, model binaries, MLflow stores and credentials are excluded from Git.

## Local setup

Use Python 3.13 and Node.js 24 LTS. From the repository root in PowerShell:

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

Open [localhost:3000](http://localhost:3000). Local API docs are at [localhost:8000/docs](http://localhost:8000/docs). Use `.venv/bin/python` on macOS/Linux. Commands below assume the virtual environment is activated, or replace `python` with its full venv path. Root `.env` configures Python; `frontend/.env.local` configures the browser's `NEXT_PUBLIC_API_URL`.

Race Control supports driver comparison, lap scrubbing/playback, chart ranges, flagged-lap inclusion, stint selection and CSV export. Pace Lab calls the real single/batch model API, shows real held-out diagnostics, and queries observed historical reference laps. Missing data/model errors are explicit. A clearly labeled frontend-only synthetic fixture remains a fallback for an unreachable/empty API; it is never training data or a historical reference.

## Reproduce ingestion, audit and training

```powershell
python -m pipeline.ingest --demo
# Or all configured completed 2023–2025 races:
python -m pipeline.ingest --all
python -m pipeline.preprocess
python -m pipeline.quality --session-keys 9472 9480 9488
python -m pipeline.quality --output docs/evidence/all-data-quality.json
python -m pipeline.train
mlflow ui --backend-store-uri sqlite:///mlflow.db --host 127.0.0.1 --port 5000
```

OpenF1's Bahrain location is **Sakhir**, not Bahrain. Requests reuse connections, respect the configured 2.1-second delay and server `Retry-After`, and reuse validated caches. Exact `404 No results found` responses are recorded as empty source endpoints; other errors remain errors. Global live-session access restrictions may temporarily require an existing authorized `OPENF1_TOKEN` or waiting. No restriction is bypassed.

`config.yaml` controls years, paths, request policy, eligibility rules, split fractions, seed, model hyperparameters and selection metric. `CONFIG_PATH` selects another config. Raw responses and manifests are stored under `data/raw/`; cleaned lap features and materialized replay snapshots are under `data/processed/`. Weather joins use only observations at/before lap start, at most five minutes old. Tyre age includes source-reported prior usage. Pit/start/caution/wet/invalid/ambiguous observations are flagged and excluded as configured. See [data/model decisions](docs/DATA_MODEL.md).

The complete preprocessing pipeline is serialized with the estimator. MLflow records both candidates, validation errors, the selected model's test errors, evaluation plots, split keys, configuration and dataset/model versions. `artifacts/current.json` atomically selects a trusted versioned joblib bundle. Never load untrusted model files.

## Google Cloud Storage

Only project **f1-pitwall-2026-qh719** / **649091037888** is authorized. The existing Anime Compass default project is unchanged. Billing and the dedicated GCS/Cloud Run/build resources were explicitly approved. Every deployment operation must verify the dedicated project identity and name its `--project`.

```powershell
# ADC is the normal SDK authentication path:
gcloud auth application-default login
python -m pipeline.ingest --all --upload
python -m pipeline.preprocess --upload
# Alternatively use the already signed-in gcloud account in memory:
python -m pipeline.gcs --gcloud-auth --include-raw
python -m pipeline.sync --dataset-version 3607cb9ef2c1a44c --gcloud-auth --training-only
python -m pipeline.train
python -m pipeline.gcs --gcloud-auth --model-only
```

The current real model was trained after restoring the checksum-verified GCS CSV. Raw data, processed versions, models and MLflow backups use separate prefixes. Processed objects have SHA-256 checksums; manifests and pointers publish after their referenced objects. Tokens are never saved or printed. A fresh clone can restore datasets and trained artifacts from authorized GCS access; binary assets are intentionally not in Git.

## API and public verification

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process, historical-data and model readiness |
| `GET /races` | Actually ingested completed race sessions |
| `GET /races/{key}/laps` | Observed lap records and training-exclusion flags |
| `GET /races/{key}/stints` | Historical stint records |
| `GET /races/{key}/replay` | Compact shared snapshots and lap/stint analysis data |
| `GET /reference` | Matching eligible observed laps by circuit/driver/team/compound |
| `GET /model/info` | Model/dataset versions, supported inputs and real diagnostics |
| `POST /predict` | Validated lap estimate plus model/dataset versions |
| `POST /predict/batch` | Up to 240 real estimates for compound curves |

`/docs` provides interactive request schemas. `/model/info` supplies a valid `example_input`. Unsupported values, combinations and numeric extrapolation are rejected with 422; absent models return 503. Extra input fields are forbidden. CORS allows only explicitly configured frontend origins.

```powershell
python scripts/verify_api.py --require-ready
python scripts/verify_api.py --base-url https://f1-pitwall-api-649091037888.us-central1.run.app --require-ready --output docs/evidence/public-api-verification.json
```

## Containers and deployment

```powershell
docker compose up --build
docker build --target base -t f1-pitwall-pipeline .
docker run --rm --env-file .env -v "${PWD}/data:/app/data" -v "${PWD}/artifacts:/app/artifacts" f1-pitwall-pipeline python -m pipeline.train
```

Both Dockerfiles have been built/tested through Cloud Build. Local compose execution remains unverified because this computer has no Docker engine. Container bind mounts must be writable by the non-root training user. The frontend API URL is compiled at build time and must resolve from the browser, not just Docker's internal network. MLflow needs a persistent directory/database/server if training in ephemeral containers; no credentials are baked into images.

See [deployment instructions](docs/DEPLOYMENT.md) for dedicated-project identity checks, service accounts, Cloud Build, Cloud Run, Vercel, CORS and resource limits. Only the dedicated API is updated; Anime Compass resources/default configuration are never changed.

## Tests and CI

```powershell
New-Item -ItemType Directory -Path .test-tmp -Force
.\.venv\Scripts\python.exe -m pytest -q --basetemp=.test-tmp/local
cd frontend
npm test
npm run typecheck
npm run build
npm audit
# Static Vercel preview fallback:
npm run export:static
npx vercel deploy out --temporary --yes
```

Use `python -m pytest`, matching CI and Docker, so repository packages are on the import path. The workspace temp directory avoids this machine's legacy Windows temp-folder ACL issue. Tests cover temporal joins, source 404 semantics, sparse position events, red flags, ambiguity, recorded real-response contracts, serialized inference, historical reference, cloud isolation, model orchestration and frontend interactions. Current local verification: 37 Python tests and 7 frontend tests pass. CI runs on PR #1; evidence for deployment checks is under `docs/evidence/`.

## Collaboration, ethics and limitations

Each teammate must submit at least one real PR; see [CONTRIBUTING.md](CONTRIBUTING.md). No PR/authorship history is fabricated and PR #1 is not automatically merged. [STATUS.md](STATUS.md) tracks remaining work.

OpenF1 is unofficial; this academic project is unaffiliated with Formula 1, FIA or teams. Respect source access/rate policies and attribution. Models are observational, not causal or physical tyre simulations. Fuel, traffic, damage, setup and regulatory changes are omitted. Errors apply to the filtered evaluation population and can be optimistic relative to all racing laps. Some source sequences are incomplete; ambiguous tyre assignments are excluded. Do not use the demonstration for safety-critical race operations or promises about race outcomes.
