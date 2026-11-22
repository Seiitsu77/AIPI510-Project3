# Project contributions

Both teammates submitted pull requests to the project repository. Their contributions are included in `main`.

| Contributor | Completed contribution | Merged PR |
| --- | --- | --- |
| [Seiitsu77](https://github.com/Seiitsu77) | Built the base Race Control and Pace Lab dashboard, the OpenF1 ingestion and preprocessing pipeline, the MLflow training and evaluation workflow, and the FastAPI service on Cloud Run. | [#1](https://github.com/Seiitsu77/AIPI510-Project3/pull/1) |
| [Cheney0919](https://github.com/Cheney0919) | Added Stint Scenario Lab with historical summaries, dry compound comparisons through the batch API, and Race Control navigation. Fixed the flagged-lap toggle and missing-lap gaps, added regression tests, and clarified the Docker setup. | [#2](https://github.com/Seiitsu77/AIPI510-Project3/pull/2) |
| [Seiitsu77](https://github.com/Seiitsu77) | Added Docker CI coverage for the training contract and clean-clone Compose startup, with setup and handoff documentation. | [#3](https://github.com/Seiitsu77/AIPI510-Project3/pull/3) |
| [Seiitsu77](https://github.com/Seiitsu77) | Documented the permanent Vercel demo and verified production replay, prediction and CORS results. | [#4](https://github.com/Seiitsu77/AIPI510-Project3/pull/4) |

PR #2 and PR #3 merged into the feature branch that reached `main` through PR #1. PR #4 merged directly into `main`.

## Ongoing contributions

Open a feature branch from `main` and describe the behavior change and relevant checks in the PR. Follow the [README](README.md#tests-and-ci) for test commands and identify which records were used when verifying data and model behavior. Keep raw archives, model binaries, credentials, local `.env` files and generated environments outside Git. Share datasets through the approved versioned GCS objects.

Verify the dedicated F1 PitWall project ID before any cloud operation and use the explicit project flag. See the [deployment runbook](docs/DEPLOYMENT.md) for resource scope and approval requirements.
