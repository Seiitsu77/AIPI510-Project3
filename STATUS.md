# F1 PitWall checklist

## Completed

- [x] Next.js/TypeScript Race Control and Pace Lab with dark engineering design and responsive CSS.
- [x] Synchronized lap scrubber, timing tower, weather, lap chart, tyre status and clickable stint timeline.
- [x] Three-driver comparison, chart ranges, flagged-lap inclusion, replay playback and CSV export.
- [x] Session/lap/comparison context retained between pages; data guide supports keyboard focus and Escape.
- [x] Three **synthetic UI fixtures**, prominently labeled and excluded from historical references/training.
- [x] FastAPI historical/replay endpoints, prediction/batch endpoints, model info, validation, CORS and OpenAPI.
- [x] Cached OpenF1 ingestion, documented schema validation, backward weather joins, tyre age and exclusion flags.
- [x] Separate raw/processed datasets, checksums, versioned GCS upload and exact-version restore.
- [x] Linear Regression and HistGradientBoosting, chronological race splits, validation selection and held-out evaluation.
- [x] MLflow parameters/metrics/models/plots and atomic versioned preprocessing/model bundles.
- [x] Full training orchestration verified with isolated synthetic contract data; never installed as a real model.
- [x] **22 Python tests** and **7 frontend tests** pass locally and in Docker via Cloud Build.
- [x] Production Next.js builds, static export, type checking and zero npm-audit findings.
- [x] Backend/frontend Docker image builds and frontend container HTTP checks pass. Compose config supplied.
- [x] README, data/model ethics and limitations, deployment runbook, CI, teammate contribution/PR guidance.
- [x] Separate GCP project `f1-pitwall-2026-qh719` / `649091037888` created after creation permission check.
- [x] Billing linked only after explicit user approval; dedicated private GCS bucket, image repository and build/runtime accounts.
- [x] Actual GCS SDK helper upload/download verified with a temporary non-race probe; probe removed.
- [x] Public Cloud Run API deployed and HTTP-tested: https://f1-pitwall-api-649091037888.us-central1.run.app
- [x] Vercel temporary preview deployed and both pages HTTP-tested: https://rushing-amber-691toc5.tmp.now
- [x] Deployed frontend JavaScript references the actual API; allowed-origin CORS succeeds and unconfigured origin is rejected.
- [x] Original default project retained; no Anime Compass deployments, IAM, billing or resources modified.

## Remaining and blockers

- [ ] Ingest at least three real races and inspect actual success-response schemas. **Blocked:** OpenF1 returns 401 during a live-session global access restriction. The user approved labeled fixture work meanwhile.
- [ ] Ingest broader 2023–2025 records, train a real model and publish held-out MAE/RMSE. **Depends on historical access.** Product model readiness remains false, with no fabricated results.
- [ ] Upload/restore the real versioned datasets and verify historical replay against records. GCS infrastructure and SDK access are verified.
- [ ] Redeploy API with actual processed records and trained artifact; verify public predictions and frontend historical/model integration.
- [ ] Claim the temporary Vercel preview for permanent ownership. It expires one hour after creation unless claimed; the private claim link is in the chat handoff, not source control.
- [ ] Desktop/mobile screenshots, chart pointer/tooltip and visual-reference QA. **Blocked:** browser automation cannot start (Windows sandbox runtime ownership error). No reference image was supplied.
- [ ] Run docker compose locally. **Blocked:** local Docker is absent; both component images were verified remotely.
- [ ] Connect the team's actual GitHub repository and have both teammates submit a real PR. No PR/authorship history is fabricated.

Build IDs, image digests, public HTTP results and readiness limits are recorded in `deploy/verification.json`. This is a deployed, tested implementation with labeled fixture data, **not yet the completed historical-data/ML MVP**.
