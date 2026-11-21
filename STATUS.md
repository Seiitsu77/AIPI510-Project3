# F1 PitWall delivery status

## P0 — real historical data: complete

- OpenF1 historical access recovered. All 70 completed 2023–2025 races were downloaded and cached without bypassing source restrictions.
- Sakhir/Bahrain 2024 (`9472`), Jeddah (`9480`) and Melbourne (`9488`) contain 3,029 observed laps with real stints/weather and synchronized Race Control replay.
- Independent raw-to-processed audits passed for all 70 sessions. The three focus races have no internal lap gaps, duplicate driver/lap keys, ambiguous stint joins, tyre-age errors or future-weather joins.
- Source gaps in other races remain visible; ambiguous tyre assignments and invalid/wet/caution laps are excluded from training, never synthesized.
- Versioned raw/processed records were uploaded to the private dedicated GCS bucket, and the training CSV was restored with its SHA-256 verified.

## P1 — real trained model: complete

- Dataset `3607cb9ef2c1a44c`: 77,373 observed laps / 61,041 eligible laps. Chronological split: 43 train, 13 validation and 13 held-out test races; one wet race has no eligible laps.
- Linear Regression won validation against HistGradientBoosting. Model `e08c75d96518` achieves held-out MAE **1.718 s**, RMSE **2.182 s**, on 11,540 laps.
- MLflow run `ba7dd85da4324047857ffd46093ad68a` is FINISHED; both candidates, configuration, splits, plots and metrics are recorded and backed up to GCS with the fitted bundle.
- Cloud Run revision `f1-pitwall-api-00003-6kw` serves 70 real races and the trained model. Public single/batch predictions agree; the documented Sakhir/VER example returns **97.1009425156 s**.
- Pace Lab calls the deployed model, displays its actual errors/version, and queries real observed historical references. Desktop prediction and a 390px mobile layout were checked in the browser.

## Verification and isolation

- The suite contains 37 Python and 12 frontend tests. The last backend Cloud Build passed all 37 Python tests. PR #2 added the Stint Scenario Lab and regression coverage for the flagged-lap toggle and missing lap gaps.
- Three real Race Control sessions were exercised in the browser. Live Pace Lab prediction, supported compound curves, held-out diagnostics and 71 matching historical reference laps were verified.
- Public API evidence: `docs/evidence/public-api-verification.json`. Data/model/cloud evidence: `docs/evidence/`. Build/release metadata: `deploy/project.json` and `deploy/verification.json`.
- Only project `f1-pitwall-2026-qh719` / `649091037888` was used. The original default project remains `project-4ea00490-f490-4348-86b`; Anime Compass resources were not modified.
- The two teammate contributions are [PR #1](https://github.com/Seiitsu77/AIPI510-Project3/pull/1) and [PR #2](https://github.com/Seiitsu77/AIPI510-Project3/pull/2). PR #2 was merged into `feat/f1-pitwall-platform`, the branch under review in PR #1.

## Remaining handoff items

- The verified temporary Vercel preview expired. A persistent frontend deployment requires an authenticated Vercel account and its production origin in API CORS.
- The GitHub Actions Docker job checks training and MLflow with contract fixtures and the clean-clone Compose stack on Linux. A data-loaded Compose run on this machine still requires a local Docker engine.

Evaluation applies to filtered historical dry/clean laps. Missing fuel, traffic, setup and damage inputs limit generalization; estimates are observational and do not establish causal tyre effects.
