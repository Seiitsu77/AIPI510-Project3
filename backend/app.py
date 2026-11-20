from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from backend import store
from backend.model import PredictionInput, BatchInput, load_model, predict

app = FastAPI(title="F1 PitWall API", version="1.0.0", description="Historical OpenF1 replay and observational race pace estimates. Never live telemetry.")
origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET","POST"], allow_headers=["Content-Type"])

@app.get("/health")
def health():
    try:
        version = load_model()["info"]["version"]
    except HTTPException:
        version = None
    return {"status":"ok", "historical_races":len(store.races()), "model_ready":version is not None, "model_version":version}

@app.get("/races")
def races():
    return store.races()

@app.get("/races/{session_key}/laps")
def laps(session_key:int):
    return store.race_data(session_key)["laps"]

@app.get("/races/{session_key}/stints")
def stints(session_key:int):
    return store.race_data(session_key)["stints"]

@app.get("/races/{session_key}/replay")
def replay(session_key:int):
    if session_key not in {race["session_key"] for race in store.races()}:
        raise HTTPException(404, "Historical session not ingested.")
    path = store.processed_dir() / f"{session_key}.json"
    if not path.exists():
        raise HTTPException(503, "Historical dataset file is missing.")
    return store.cached_replay(str(path), path.stat().st_mtime_ns)

@app.get("/model/info")
def model_info():
    try:
        return load_model()["info"]
    except HTTPException as error:
        return JSONResponse(status_code=503, content={"available":False, "detail":error.detail})

@app.get("/reference")
def reference(circuit: str = Query(min_length=1, max_length=80),
              driver: str = Query(min_length=2, max_length=6),
              team: str = Query(min_length=1, max_length=80),
              compound: str = Query(pattern="^(SOFT|MEDIUM|HARD|INTERMEDIATE|WET)$")):
    return store.historical_reference(circuit, driver, team, compound)

@app.post("/predict")
def prediction(item:PredictionInput):
    return predict([item])[0]

@app.post("/predict/batch")
def batch_prediction(batch:BatchInput):
    return {"predictions":predict(batch.items)}
