"""End-to-end training contract using synthetic records in isolated test directories.

The source field simulates the upstream manifest contract. These are not historical
records, and neither artifacts nor their metrics are installed in the application.
"""
import copy
import hashlib
import json
import joblib
import numpy as np
import pandas as pd
import pytest
from pipeline import train
from pipeline.settings import config


def test_training_selection_mlflow_and_serialized_inference(tmp_path,monkeypatch):
    import mlflow
    processed=tmp_path/"processed";processed.mkdir()
    artifacts=tmp_path/"artifacts"
    # Ten simulated sessions exercise group splits and every orchestration step.
    rows=[]
    for session in range(1,11):
        for lap in range(2,42):
            age=(lap-2)%20
            compound="SOFT" if lap<20 else "HARD"
            rows.append({"session_key":session,"session_date":f"2024-{session:02d}-01", "circuit":"CONTRACT_TEST", "driver":"TST", "team":"Test Team", "compound":compound,"tyre_age":age,"race_lap":lap,"track_temperature":30.0,"rainfall":0,"lap_duration":90+age*.12-lap*.03+np.sin(lap)*.05,"eligible":True})
    frame=pd.DataFrame(rows);csv=processed/"laps.csv";frame.to_csv(csv,index=False)
    (processed/"dataset.json").write_text(json.dumps({"source":"OpenF1","version":"synthetic-contract-test-only","csv_sha256":hashlib.sha256(csv.read_bytes()).hexdigest()}))
    settings=copy.deepcopy(config())
    settings["data"]["processed_dir"]=str(processed)
    settings["model"]["artifact_dir"]=str(artifacts)
    settings["model"]["experiment"]="Synthetic contract verification only"
    settings["model"]["hyperparameters"]["max_iter"]=8
    monkeypatch.setattr(train,"config",lambda:settings)
    monkeypatch.setenv("MLFLOW_TRACKING_URI",f"sqlite:///{(tmp_path/'tracking.db').as_posix()}")
    mlflow.set_tracking_uri(f"sqlite:///{(tmp_path/'tracking.db').as_posix()}")
    mlflow.create_experiment(settings["model"]["experiment"], artifact_location=(tmp_path/"mlartifacts").as_uri())
    train.main()
    pointer=json.loads((artifacts/"current.json").read_text())
    bundle=joblib.load(artifacts/pointer["file"])
    info=bundle["info"]
    assert info["dataset_version"]=="synthetic-contract-test-only"
    assert set(info["candidates"])=={"linear_regression","hist_gradient_boosting"}
    assert info["split"]=={"train":[1,2,3,4,5,6],"validation":[7,8],"test":[9,10]}
    assert info["rows"]=={"train":240,"validation":80,"test":80}
    assert info["model"]==min(info["candidates"],key=lambda name:info["candidates"][name]["mae"])
    assert np.isfinite(bundle["pipeline"].predict(frame[train.FEATURES].iloc[:2])).all()
    run=mlflow.get_run(info["mlflow_run_id"])
    assert "test_mae" in run.data.metrics and "test_rmse" in run.data.metrics
    assert (artifacts/"evaluation.png").exists()


def test_training_refuses_fixture_provenance(tmp_path,monkeypatch):
    (tmp_path/"dataset.json").write_text(json.dumps({"source":"Synthetic UI fixture"}))
    settings=copy.deepcopy(config());settings["data"]["processed_dir"]=str(tmp_path)
    monkeypatch.setattr(train,"config",lambda:settings)
    with pytest.raises(ValueError,match="real OpenF1"):
        train.main()
