import json
from pathlib import Path
from pipeline.schemas import validate
from pipeline.preprocess import process_session
from pipeline.settings import config
from pipeline.quality import audit_session
import pytest

SAMPLES=json.loads((Path(__file__).parent/"fixtures/openf1-samples.json").read_text(encoding="utf-8"))["samples"]

@pytest.mark.parametrize("sample",SAMPLES,ids=[str(s["session"]["session_key"]) for s in SAMPLES])
def test_recorded_openf1_schema_and_preserved_lap_grain(sample):
    validate("sessions",[sample["session"]])
    for endpoint,records in sample["source"].items():validate(endpoint,records)
    rows=process_session(sample["session"],sample["source"],config()["evaluation"])
    assert len(rows)==len(sample["source"]["laps"])
    assert all(r["weather_age_seconds"] is None or 0<=r["weather_age_seconds"]<=300 for r in rows)


def test_bahrain_recorded_stint_transition_and_exact_observed_time():
    sample=SAMPLES[0]
    rows=process_session(sample["session"],sample["source"],config()["evaluation"])
    by_lap={r["race_lap"]:r for r in rows}
    assert by_lap[17]["compound"]=="SOFT"
    assert by_lap[18]["compound"]=="HARD" and by_lap[18]["tyre_age"]==0
    assert by_lap[37]["compound"]=="HARD"
    assert by_lap[38]["compound"]=="SOFT"
    assert by_lap[3]["lap_duration"]==sample["source"]["laps"][1]["lap_duration"]
    assert "pit_lap" in by_lap[17]["exclusions"]


def test_null_duration_retirement_record_stays_excluded():
    sample=SAMPLES[2]
    rows=process_session(sample["session"],sample["source"],config()["evaluation"])
    retired=next(r for r in rows if r["race_lap"]==4)
    assert retired["lap_duration"] is None and not retired["eligible"]
    assert "unknown_stint" in retired["exclusions"]
