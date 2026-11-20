import copy
import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LinearRegression
from backend.app import app
from backend import model, store
from pipeline.train import make_pipeline, FEATURES
from pipeline.ingest import atomic_json

INPUT={"circuit":"TEST","driver":"TST","team":"Test Team","compound":"MEDIUM","tyre_age":5,"race_lap":10,"track_temperature":30,"rainfall":0}

@pytest.fixture
def client(monkeypatch,tmp_path):
    monkeypatch.setattr(store,"processed_dir",lambda:tmp_path/"processed")
    monkeypatch.setattr(model,"config",lambda:{"model":{"artifact_dir":str(tmp_path/"artifacts")}})
    model._load.cache_clear()
    return TestClient(app)

@pytest.fixture
def trained(monkeypatch,tmp_path,client):
    # Isolated synthetic estimator for serialization and HTTP-contract tests, not a deployment artifact.
    data=pd.DataFrame([{**INPUT,"tyre_age":i,"race_lap":i+1} for i in range(30)])
    pipeline=make_pipeline(LinearRegression()).fit(data[FEATURES],90+data.tyre_age*.1)
    info={"available":True,"version":"unit-test-only","dataset_version":"synthetic-test","support":{k:[INPUT[k]] for k in ("circuit","driver","team","compound")},"combinations":[{k:INPUT[k] for k in ("circuit","driver","team","compound")}],"ranges":{"tyre_age":[0,29],"race_lap":[1,30],"track_temperature":[30,30],"rainfall":[0,0]}}
    path=tmp_path/"artifacts";path.mkdir()
    joblib.dump({"pipeline":pipeline,"info":info},path/"model-test.joblib")
    atomic_json(path/"current.json",{"file":"model-test.joblib","version":"unit-test-only"})
    return client,pipeline

def test_health_and_absent_artifacts_are_explicit(client):
    assert client.get("/health").json()["model_ready"] is False
    assert client.get("/races").json()==[]
    assert client.get("/races/999/laps").status_code==404
    assert client.get("/model/info").status_code==503
    assert client.post("/predict",json=INPUT).status_code==503

def test_serialized_training_preprocessing_is_used_by_inference(trained):
    client,pipeline=trained
    response=client.post("/predict",json=INPUT)
    assert response.status_code==200
    expected=pipeline.predict(pd.DataFrame([INPUT])[FEATURES])[0]
    assert response.json()["lap_duration"]==pytest.approx(expected)
    assert response.json()["model_version"]=="unit-test-only"
    assert client.get("/health").json()["model_ready"] is True
    batch=client.post("/predict/batch",json={"items":[INPUT,{**INPUT,"tyre_age":10}]})
    assert batch.status_code==200 and len(batch.json()["predictions"])==2

@pytest.mark.parametrize("changes",[{"tyre_age":-1},{"tyre_age":2.5},{"circuit":"UNKNOWN"},{"compound":"WET"},{"track_temperature":60},{"duration_sector_1":20},{"rainfall":2}])
def test_unsupported_or_leaking_inputs_are_rejected(trained,changes):
    client,_=trained
    assert client.post("/predict",json={**INPUT,**changes}).status_code==422

def test_batch_size_limit(client):
    assert client.post("/predict/batch",json={"items":[INPUT]*241}).status_code==422

def test_cors_uses_explicit_origin(client):
    response=client.options("/predict",headers={"Origin":"http://localhost:3000","Access-Control-Request-Method":"POST"})
    assert response.headers["access-control-allow-origin"]=="http://localhost:3000"
    denied=client.options("/predict",headers={"Origin":"https://untrusted.example","Access-Control-Request-Method":"POST"})
    assert denied.status_code==400
