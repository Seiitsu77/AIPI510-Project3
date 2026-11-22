from functools import lru_cache
import json
import math
import joblib
import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from pipeline.settings import config, resolve
from pipeline.train import FEATURES

class PredictionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    circuit: str = Field(min_length=1, max_length=80)
    driver: str = Field(min_length=2, max_length=6)
    team: str = Field(min_length=1, max_length=80)
    compound: Literal["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]
    tyre_age: int = Field(ge=0, le=100)
    race_lap: int = Field(ge=1, le=100)
    track_temperature: float = Field(ge=0, le=80)
    rainfall: Literal[0, 1] = 0

class BatchInput(BaseModel):
    items: list[PredictionInput] = Field(min_length=1, max_length=240)

@lru_cache(maxsize=2)
def _load(path, modified):
    # Only trusted artifacts created by the training pipeline may enter this directory.
    return joblib.load(path)

def load_model():
    directory = resolve(config()["model"]["artifact_dir"])
    pointer = directory / "current.json"
    if not pointer.exists():
        raise HTTPException(503, "No trained historical model. Ingest real races and run python -m pipeline.train.")
    name = json.loads(pointer.read_text())["file"]
    path = (directory / name).resolve()
    if path.parent != directory.resolve() or not path.exists():
        raise HTTPException(503, "Configured model artifact is missing or invalid.")
    return _load(str(path), path.stat().st_mtime_ns)

def predict(items):
    bundle = load_model()
    info = bundle["info"]
    for item in items:
        values = item.model_dump()
        for field, allowed in info["support"].items():
            if values[field] not in allowed:
                raise HTTPException(422, f"Unsupported {field}: {values[field]}; use values from /model/info.")
        if {key:values[key] for key in ("circuit","driver","team","compound")} not in info["combinations"]:
            raise HTTPException(422, "This circuit/driver/team/compound combination was not present in training.")
        for field, (minimum,maximum) in info["ranges"].items():
            if not minimum <= values[field] <= maximum:
                raise HTTPException(422, f"{field} outside training range [{minimum}, {maximum}].")
    frame = pd.DataFrame([item.model_dump() for item in items])[FEATURES]
    values = bundle["pipeline"].predict(frame)
    if any(not math.isfinite(float(v)) or v <= 0 for v in values):
        raise HTTPException(503, "Model returned an invalid lap duration.")
    return [{"lap_duration":float(value), "model_version":info["version"], "dataset_version":info["dataset_version"]} for value in values]
