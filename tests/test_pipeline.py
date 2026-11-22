"""Small synthetic contract fixtures; never persisted as historical training data."""
from datetime import datetime, timezone
import copy
import json
import pandas as pd
import pytest
from pydantic import ValidationError
from pipeline.preprocess import process_session, latest_before, caution_windows
from pipeline.schemas import validate
from pipeline.train import chronological_split, make_pipeline, FEATURES
from pipeline.settings import config
from pipeline.ingest import fetch, AccessRestricted

@pytest.fixture
def source():
    session = {"session_key":1,"date_start":"2024-01-01T00:00:00+00:00","date_end":"2024-01-01T02:00:00+00:00","circuit_short_name":"TEST"}
    raw = {"drivers":[{"driver_number":1,"name_acronym":"TST","team_name":"Test Team"}],
           "stints":[{"driver_number":1,"stint_number":1,"lap_start":1,"lap_end":3,"compound":"MEDIUM","tyre_age_at_start":4}, {"driver_number":1,"stint_number":2,"lap_start":4,"lap_end":6,"compound":"HARD","tyre_age_at_start":0}],
           "weather":[{"date":"2024-01-01T00:00:00+00:00","track_temperature":30,"rainfall":0},{"date":"2024-01-01T00:04:00+00:00","track_temperature":50,"rainfall":0}],
           "laps":[{"driver_number":1,"lap_number":n,"date_start":f"2024-01-01T00:{(n-1):02d}:00+00:00","lap_duration":60,"is_pit_out_lap":n==4} for n in range(1,7)],
           "pit":[], "race_control":[]}
    return session, raw

def test_weather_is_backward_only_and_age_includes_prior_usage(source):
    session, raw=source
    rows=process_session(session,raw,config()["evaluation"])
    assert rows[1]["track_temperature"]==30  # future 50 C cannot leak into lap 2
    assert rows[1]["tyre_age"]==5
    assert rows[3]["tyre_age"]==0
    assert rows[4]["track_temperature"]==50
    assert "standing_start" in rows[0]["exclusions"]
    assert "pit_lap" in rows[2]["exclusions"]
    assert "pit_lap" in rows[3]["exclusions"]

def test_missing_weather_is_not_imputed_from_future():
    rows=[{"date":"2024-01-01T00:01:00+00:00","track_temperature":31}]
    assert latest_before(rows,datetime(2024,1,1,tzinfo=timezone.utc)) is None
    assert latest_before(rows,datetime(2024,1,1,0,7,tzinfo=timezone.utc)) is None

def test_caution_excludes_overlapping_lap_even_when_start_is_green(source):
    session,raw=source
    raw["race_control"]=[{"date":"2024-01-01T00:01:30+00:00","category":"SafetyCar","message":"SAFETY CAR DEPLOYED"},{"date":"2024-01-01T00:03:00+00:00","category":"SafetyCar","message":"SAFETY CAR IN THIS LAP"}]
    rows=process_session(session,raw,config()["evaluation"])
    assert "caution" in rows[1]["exclusions"]
    assert "caution" in rows[4]["exclusions"]  # conservative restart buffer

def test_incomplete_stint_and_null_age_are_not_made_up(source):
    session,raw=source
    raw["stints"][0]["tyre_age_at_start"]=None
    rows=process_session(session,raw,config()["evaluation"])
    assert rows[1]["tyre_age"] is None
    assert "unknown_tyre_age" in rows[1]["exclusions"]
    assert not rows[1]["eligible"]

def test_schema_rejects_wrong_shape_and_missing_required_fields():
    with pytest.raises(ValueError):validate("laps",{})
    with pytest.raises(ValidationError):validate("laps",[{"session_key":1,"driver_number":1}])
    result=validate("laps",[{"session_key":1,"driver_number":1,"lap_number":1,"new_upstream_field":True}])
    assert result[0]["new_upstream_field"] is True

def test_chronological_race_groups_are_disjoint():
    data=pd.DataFrame([{"session_key":s,"session_date":f"2024-{s:02d}-01"} for s in range(1,11) for _ in range(3)])
    splits,keys=chronological_split(data,config())
    assert keys=={"train":[1,2,3,4,5,6],"validation":[7,8],"test":[9,10]}
    assert set(keys["train"]).isdisjoint(keys["test"])
    assert len(splits["test"])==6
    with pytest.raises(ValueError):chronological_split(data[data.session_key<=3],config())

def test_live_access_restriction_is_not_retried_or_cached(monkeypatch,tmp_path):
    import httpx
    calls=[]
    def restricted(*args,**kwargs):
        calls.append(1)
        return httpx.Response(401,request=httpx.Request("GET","https://example.test"))
    monkeypatch.setattr("pipeline.ingest.httpx.get",restricted)
    path=tmp_path/"sessions.json"
    with pytest.raises(AccessRestricted):fetch("sessions",{},path,config()["data"])
    assert len(calls)==1 and not path.exists()

def test_cached_responses_do_not_hit_network(monkeypatch,tmp_path):
    path=tmp_path/"laps.json"
    path.write_text(json.dumps([{"session_key":1,"driver_number":1,"lap_number":2}]))
    def fail(*a,**k):raise AssertionError("Network must not be used for a valid cache")
    monkeypatch.setattr("pipeline.ingest.httpx.get",fail)
    assert len(fetch("laps",{},path,config()["data"]))==1


def test_explicit_no_results_is_preserved_as_empty_source(monkeypatch,tmp_path):
    import httpx
    response=httpx.Response(404,json={"detail":"No results found."},request=httpx.Request("GET","https://api.openf1.org/v1/pit"))
    monkeypatch.setattr("pipeline.ingest.httpx.get",lambda *a,**k:response)
    monkeypatch.setattr("pipeline.ingest.time.sleep",lambda *a:None)
    path=tmp_path/"pit.json"
    assert fetch("pit",{},path,config()["data"])==[]
    assert json.loads(path.read_text())==[]


def test_other_404_is_not_disguised_as_empty_data(monkeypatch,tmp_path):
    import httpx
    response=httpx.Response(404,json={"detail":"Not Found"},request=httpx.Request("GET","https://example.test/typo"))
    monkeypatch.setattr("pipeline.ingest.httpx.get",lambda *a,**k:response)
    with pytest.raises(httpx.HTTPStatusError):fetch("pit",{},tmp_path/"pit.json",config()["data"])


def test_duplicate_lap_grain_fails_and_ambiguous_stints_remain_unknown(source):
    session,raw=source
    original=copy.deepcopy(raw)
    raw["laps"].append(copy.deepcopy(raw["laps"][0]))
    with pytest.raises(ValueError,match="Duplicate lap key"):process_session(session,raw,config()["evaluation"])
    raw=original
    raw["stints"].append({**raw["stints"][0],"stint_number":3})
    rows=process_session(session,raw,config()["evaluation"])
    assert rows[1]["compound"] is None and rows[1]["tyre_age"] is None
    assert "ambiguous_stint" in rows[1]["exclusions"] and not rows[1]["eligible"]


def test_clearing_one_sector_does_not_clear_another_yellow():
    events=[{"date":"2024-01-01T00:00:00+00:00","category":"Flag","flag":"YELLOW","scope":"Sector","sector":2,"message":"YELLOW"},
            {"date":"2024-01-01T00:00:10+00:00","category":"Flag","flag":"YELLOW","scope":"Sector","sector":15,"message":"YELLOW"},
            {"date":"2024-01-01T00:00:20+00:00","category":"Flag","flag":"CLEAR","scope":"Sector","sector":2,"message":"CLEAR"},
            {"date":"2024-01-01T00:02:00+00:00","category":"Flag","flag":"CLEAR","scope":"Sector","sector":15,"message":"CLEAR"}]
    windows=caution_windows(events,datetime(2024,1,1,2,tzinfo=timezone.utc))
    point=datetime(2024,1,1,0,1,tzinfo=timezone.utc)
    assert any(start<=point<=end for start,end in windows)


def test_red_flag_ends_preceding_safety_car_without_leaking_caution_to_finish():
    events=[{"date":"2023-11-05T17:03:50+00:00","category":"SafetyCar","message":"SAFETY CAR DEPLOYED"},
            {"date":"2023-11-05T17:06:35+00:00","category":"Flag","flag":"RED","scope":"Track","message":"RED FLAG"},
            {"date":"2023-11-05T17:27:51+00:00","category":"Flag","flag":"CLEAR","scope":"Track","message":"TRACK CLEAR"}]
    windows=caution_windows(events,datetime(2023,11,5,19,tzinfo=timezone.utc))
    restart=datetime(2023,11,5,17,28,tzinfo=timezone.utc)
    green=datetime(2023,11,5,17,35,tzinfo=timezone.utc)
    assert any(start<=restart<=end for start,end in windows)
    assert not any(start<=green<=end for start,end in windows)
