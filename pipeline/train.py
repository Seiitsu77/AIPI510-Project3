"""Race-group chronological holdouts. Selection uses validation only; test scored once."""
from datetime import datetime, timezone
import hashlib
import json
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from pipeline.ingest import atomic_json
from pipeline.settings import config, resolve

CATEGORICAL = ["circuit", "driver", "team", "compound"]
NUMERIC = ["tyre_age", "race_lap", "track_temperature", "rainfall"]
FEATURES = CATEGORICAL + NUMERIC


def chronological_split(frame, settings):
    races = frame[["session_key", "session_date"]].drop_duplicates().sort_values(["session_date", "session_key"])
    count = len(races)
    if count < settings["evaluation"]["minimum_races"]:
        raise ValueError(f"Need at least {settings['evaluation']['minimum_races']} real races for train/validation/test; got {count}. Ingest --all.")
    fractions = settings["split"]
    if not 0 < fractions["test_fraction"] < 1 or not 0 < fractions["validation_fraction"] < 1 or fractions["test_fraction"] + fractions["validation_fraction"] >= 1:
        raise ValueError("Invalid chronological split fractions")
    n_test = max(1, int(count * fractions["test_fraction"]))
    n_valid = max(1, int(count * fractions["validation_fraction"]))
    keys = races.session_key.tolist()
    groups = {"train": keys[:count-n_test-n_valid], "validation": keys[count-n_test-n_valid:count-n_test], "test": keys[count-n_test:]}
    return {name: frame[frame.session_key.isin(ids)].copy() for name, ids in groups.items()}, groups


def make_pipeline(estimator):
    preprocess = ColumnTransformer([
        ("categorical", Pipeline([("impute", SimpleImputer(strategy="most_frequent")), ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]), CATEGORICAL),
        ("numeric", SimpleImputer(strategy="median"), NUMERIC),
    ])
    return Pipeline([("preprocess", preprocess), ("model", estimator)])


def scores(actual, prediction):
    return {"mae": float(mean_absolute_error(actual, prediction)), "rmse": float(root_mean_squared_error(actual, prediction))}


def main():
    import mlflow
    import mlflow.sklearn
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    settings = config()
    directory = resolve(settings["data"]["processed_dir"])
    manifest = json.loads((directory / "dataset.json").read_text())
    if manifest["source"] != "OpenF1":
        raise ValueError("Deployment training requires a real OpenF1 dataset; UI fixtures are never used.")
    if hashlib.sha256((directory / "laps.csv").read_bytes()).hexdigest() != manifest["csv_sha256"]:
        raise ValueError("Processed CSV checksum differs from dataset manifest; rebuild the dataset.")
    data = pd.read_csv(directory / "laps.csv")
    data = data[data.eligible.eq(True)].dropna(subset=["lap_duration"])
    splits, groups = chronological_split(data, settings)
    train, valid, test = (splits[name] for name in ("train", "validation", "test"))
    models = {"linear_regression": LinearRegression(), "hist_gradient_boosting": HistGradientBoostingRegressor(random_state=settings["seed"], **settings["model"]["hyperparameters"])}
    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", f"sqlite:///{resolve('mlflow.db').as_posix()}")
    mlflow.set_tracking_uri(tracking_uri)
    experiment = settings["model"]["experiment"]
    if tracking_uri.startswith("sqlite:") and mlflow.get_experiment_by_name(experiment) is None:
        mlflow.create_experiment(experiment, artifact_location=resolve("mlruns").as_uri())
    mlflow.set_experiment(experiment)
    output = resolve(settings["model"]["artifact_dir"])
    output.mkdir(parents=True, exist_ok=True)
    candidates = {}
    with mlflow.start_run(run_name=f"dataset-{manifest['version']}") as parent:
        mlflow.log_params({"dataset_version": manifest["version"], "seed": settings["seed"], "train_races": len(groups["train"]), "validation_races": len(groups["validation"]), "test_races": len(groups["test"]), "features": ",".join(FEATURES)})
        mlflow.log_dict(settings, "config.json")
        mlflow.log_dict(groups, "split.json")
        for name, estimator in models.items():
            with mlflow.start_run(run_name=name, nested=True):
                pipeline = make_pipeline(estimator)
                pipeline.fit(train[FEATURES], train.lap_duration)
                metrics = scores(valid.lap_duration, pipeline.predict(valid[FEATURES]))
                mlflow.log_params(estimator.get_params())
                mlflow.log_metrics({f"validation_{k}": v for k,v in metrics.items()})
                mlflow.sklearn.log_model(pipeline, name="candidate", input_example=train[FEATURES].head(2))
                candidates[name] = (pipeline, metrics)
        selection_metric = settings["model"]["selection_metric"]
        if selection_metric not in {"mae", "rmse"}:
            raise ValueError("model.selection_metric must be mae or rmse")
        selected = min(candidates, key=lambda name: candidates[name][1][selection_metric])
        pipeline, validation = candidates[selected]
        # Keep the training fit fixed: no test rows participate in fitting or selection.
        predicted = pipeline.predict(test[FEATURES])
        metrics = scores(test.lap_duration, predicted)
        version = hashlib.sha256(f"{manifest['version']}:{parent.info.run_id}".encode()).hexdigest()[:12]
        fig, ax = plt.subplots(figsize=(6,5))
        ax.scatter(test.lap_duration, predicted, s=4, alpha=.3)
        limits = [float(min(test.lap_duration.min(), predicted.min())), float(max(test.lap_duration.max(), predicted.max()))]
        ax.plot(limits, limits, "r--")
        ax.set(xlabel="Observed lap duration (s)", ylabel="Predicted lap duration (s)", title="Held-out races")
        fig.tight_layout()
        fig.savefig(output / "evaluation.png", dpi=150)
        plt.close(fig)
        mlflow.log_metrics({f"test_{k}":v for k,v in metrics.items()})
        mlflow.log_param("selected_model", selected)
        mlflow.log_artifact(str(output / "evaluation.png"))
        mlflow.sklearn.log_model(pipeline, name="deployment", input_example=train[FEATURES].head(2))
        sample = test.assign(predicted=predicted).iloc[::max(1,len(test)//300)].head(300)
        support = {col: sorted(train[col].dropna().unique().tolist()) for col in CATEGORICAL}
        combinations = train[CATEGORICAL].drop_duplicates().to_dict(orient="records")
        info = {"available": True, "version": version, "dataset_version": manifest["version"], "model": selected,
                "trained_at": datetime.now(timezone.utc).isoformat(), "test_metrics": metrics, "validation_metrics": validation,
                "candidates": {k:v[1] for k,v in candidates.items()}, "split": groups, "rows": {k:len(v) for k,v in splits.items()},
                "support": support, "combinations": combinations,
                "ranges": {col: [float(train[col].min()), float(train[col].max())] for col in NUMERIC},
                "evaluation": sample[["session_key", "lap_duration", "predicted"]].to_dict(orient="records"),
                "mlflow_run_id": parent.info.run_id, "limitations": "Observational race pace estimates, not causal tyre simulations. No fuel, traffic, damage, or setup features. Chronological unseen circuits/drivers may reduce test quality."}
        artifact = output / f"model-{version}.joblib"
        joblib.dump({"pipeline": pipeline, "info": info}, artifact)
        # Immutable versioned model first, then atomic pointer: serving never pairs different model/info versions.
        atomic_json(output / "current.json", {"file": artifact.name, "version": version})
        atomic_json(output / "model-info.json", info)
        mlflow.log_dict(info, "model-info.json")
        print(json.dumps({"selected": selected, "test":metrics, "version":version, "run":parent.info.run_id},indent=2))

if __name__ == "__main__":
    main()
