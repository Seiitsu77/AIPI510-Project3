# Data contracts and modeling decisions

OpenF1 documentation: https://openf1.org/docs/. Its documented fields were inspected before implementation. A real request to `/v1/sessions?year=2024&session_name=Race` returned 401 with a live-session restriction message. Consequently no historical success-response schema is claimed to have been observed. `pipeline/schemas.py` encodes documented endpoint contracts and ingestion validates every record on download and cache reads; validate these against actual responses once access returns. Unknown fields remain in raw JSON. No access restriction is bypassed.

## Join semantics

- Keys: session key and driver number. Stints match inclusive `lap_start`–`lap_end`. Tyre age is `lap_number - lap_start + tyre_age_at_start`, meaning laps on the set **at lap start**. Missing prior tyre usage stays missing.
- Weather: latest observation at or before lap start, at most five minutes old. Missing weather stays null and is ineligible for training. Future observations never fill an earlier lap. All time comparisons use timezone-aware datetimes.
- Lap completion for replay is reconstructed as `date_start + lap_duration`. OpenF1 lap-start timestamps are approximate; this is not high-frequency telemetry. The selected replay timestamp is the earliest completion of the selected lap. Each driver's last completed lap, latest position, gap, and weather are selected at or before that timestamp. Position/gap observations older than 90 seconds are omitted. Weather older than five minutes is omitted. A retired/lapped driver's last recorded lap may be older than the selected leader lap; tyre panels explicitly refer to that driver's last completed lap.
- Stint transitions mark an inferred pit transition, not a measured pit entry. Source `/pit` records supplement these boundaries for training exclusions. In/out laps are marked.
- Replay preserves every source lap, including excluded training rows. Charts hide flagged laps by default, leave gaps, and allow explicit inclusion. All related dashboard panels share one selected replay lap.

## Exclusion rules

Standing starts; null/nonfinite durations and values outside configured 45–200 seconds; missing timestamps; pit in/out laps; overlapping caution windows; deleted laps when driver/lap metadata exists; unknown stint, compound, or tyre age; missing/stale weather; and wet conditions/tyres for the configured dry-only model are ineligible. At least ten otherwise eligible driver laps are required before applying a conservative target-based pace-outlier check outside 85–115% of that driver's session median. This QC rule uses the target for row filtering only, never as an input feature, and can make held-out performance optimistic relative to all racing laps.

Safety-car/VSC messages open a global caution window. Ending/in-this-lap messages keep a conservative 120-second restart buffer. Yellow/red track/sector flags are conservatively excluded until a green/clear flag; open windows extend to session end. This can discard valid green laps and is not an official FIA neutralization reconstruction. Source race-control deletions without usable driver/lap metadata may escape detection. Official results, timing corrections, localized yellow flags, and red-flag restarts require more validation before operational use.

## Model and reproducibility

Features are circuit, driver, team, compound, tyre age, race lap, track temperature and rainfall. Target is lap duration. Sector times, actual lap duration, future pit decisions and final results are excluded from predictor columns. A `ColumnTransformer` containing imputation and one-hot encoding is fit only on the earliest training races and serialized with its regressor. Both Linear Regression and HistGradientBoosting are evaluated on later validation races. Selection uses the configured metric; only the selected model is evaluated on the final chronological test races. The selected fit is not refit using test data.

HistGradientBoosting internal early stopping is disabled to avoid a random internal validation split. The minimum is five races; three replay sessions alone are insufficient for a meaningful race-group split. Chronological splits can encounter unseen drivers/circuits/compounds in test races; the encoder handles them for evaluation, while serving rejects unsupported values, combinations and extrapolation outside numeric training ranges.

MLflow records configuration, feature names, seed, raw-derived dataset version, candidate parameters/validation errors, the selected estimator, held-out MAE/RMSE, evaluation plot, preprocessing pipeline, split keys and model version. Dataset versions include raw hashes, preprocessing code and exclusion settings. The processed CSV is checked against its manifest before training. The versioned joblib artifact and model information are written together; an atomic `current.json` pointer is advanced last.

UI fixtures have negative session keys and a synthetic source banner, live only in `frontend/lib/fixture.ts`, and are never served as historical records or used for training. Tests use synthetic fixtures in temporary directories and never install those artifacts into the product.

## Ethics and limits

This independent academic tool is unaffiliated with Formula 1, FIA or teams. OpenF1 is an unofficial source; respect its access policy, request limits and upstream rights. Cache data and attribute OpenF1. Treat driver numbers/names as public sporting records; do not infer sensitive traits. These models do not measure driver skill or establish causal tyre degradation. Fuel, traffic, strategy, damage, setup, track evolution and changing regulations confound estimates. Do not use this demonstration for safety decisions, betting guarantees or actual race engineering operations.
