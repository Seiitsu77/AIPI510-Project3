# Parallel contributions and real pull requests

The assignment requires each teammate to submit at least one real PR. This repository intentionally contains no invented authorship or PR history. Initialize/connect the project to the team's actual GitHub repository when ready.

Suggested boundaries:

| Contributor | Primary scope | Independent checks |
| --- | --- | --- |
| Teammate A | `pipeline/`, data contracts, training and MLflow | pytest; inspect real ingestion manifests and evaluation artifacts |
| Teammate B | `frontend/`, dashboard, Pace Lab, accessibility | frontend tests, typecheck, production build and browser QA |
| Shared review | `backend/`, deployment, API contracts, docs | API verification and real end-to-end demonstration |

Use feature branches and keep real changes reviewable. For example, one PR can validate OpenF1 success-response schemas and ingest the initial sessions; another can complete screenshot QA and refine dashboard interactions. Both teammates should review the API and feature semantics together. Do not create empty or cosmetic PRs solely to fabricate participation.

Before each PR, describe the concrete problem, resulting behavior and checks. Include known limits, especially fixture vs observed data and whether deployment was tested. Never commit raw API archives, models, credentials, local `.env`, or generated environments. Share datasets via approved versioned GCS objects after billing is approved.

Create a separate F1 PitWall GitHub repository; do not change Anime Compass code, cloud resources or default gcloud configuration. A production deployment requires verification of the dedicated project ID and the user's billing approval.
