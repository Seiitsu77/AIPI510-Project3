from bisect import bisect_right
from functools import lru_cache
import json
import pandas as pd
from fastapi import HTTPException
from pipeline.settings import config, resolve
from pipeline.preprocess import timestamp


def processed_dir():
    return resolve(config()["data"]["processed_dir"])


def races():
    path = processed_dir() / "races.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


@lru_cache(maxsize=8)
def _read(path, modified):
    return json.loads(resolve(path).read_text(encoding="utf-8"))


def race_data(key):
    if key not in {race["session_key"] for race in races()}:
        raise HTTPException(404, "Historical session not ingested. Run the ingestion and preprocessing commands.")
    path = processed_dir() / f"{key}.json"
    if not path.exists():
        raise HTTPException(503, "Race metadata exists but its dataset is missing; rebuild the dataset.")
    return _read(str(path), path.stat().st_mtime_ns)


def replay(data):
    by_driver = {}
    positions, intervals = {}, {}
    for lap in data["laps"]:
        if lap.get("date_end"):
            by_driver.setdefault(lap["driver_number"], []).append(lap)
    for rows in by_driver.values():
        rows.sort(key=lambda row: timestamp(row["date_end"]))
    for field, groups in (("position", positions), ("intervals", intervals)):
        for row in data[field]:
            groups.setdefault(row["driver_number"], []).append(row)
        for number, rows in groups.items():
            rows.sort(key=lambda row: timestamp(row["date"]))
            groups[number] = ([timestamp(r["date"]) for r in rows], rows)
    lap_times = {number: [timestamp(r["date_end"]) for r in rows] for number, rows in by_driver.items()}
    snapshots = []
    for number in range(1, data["race"]["total_laps"]+1):
        crossings = [timestamp(row["date_end"]) for row in data["laps"] if row["race_lap"] == number and row.get("date_end")]
        if not crossings:
            snapshots.append({"lap": number, "date": None, "drivers": [], "weather": None})
            continue
        point = min(crossings)
        tower = []
        for driver in data["drivers"]:
            key = driver["driver_number"]
            laps = by_driver.get(key, [])
            i = bisect_right(lap_times.get(key, []), point)-1
            last = laps[i] if i >= 0 else None
            values = {"position": None, "gap_to_leader": None}
            for field, groups in (("position",positions),("gap_to_leader",intervals)):
                times, rows = groups.get(key, ([],[]))
                j = bisect_right(times, point)-1
                # /position is a change-event stream, not a periodic heartbeat.
                # An unchanged race lead remains valid for many minutes. Only
                # high-frequency interval observations have the freshness cap.
                if j >= 0 and (field == "position" or (point-times[j]).total_seconds() <= 90):
                    values[field] = rows[j].get(field)
            completed = last["race_lap"] if last else 0
            matches = [s for s in data["stints"] if s["driver_number"] == key and s.get("lap_start") is not None and s.get("lap_end") is not None and s["lap_start"] <= completed <= s["lap_end"]]
            stint = matches[0] if len(matches) == 1 else None
            tower.append({**driver, **values, "completed_lap": completed, "lap_duration": last["lap_duration"] if last else None,
                          "compound": last["compound"] if last else None, "tyre_age": last["tyre_age"] if last else None,
                          "stint": stint, "exclusions": last["exclusions"] if last else []})
        tower.sort(key=lambda d:(d["position"] is None,d["position"] or 99,d["driver_number"]))
        observed = [w for w in data["weather"] if timestamp(w["date"]) <= point and (point-timestamp(w["date"])).total_seconds() <= 300]
        snapshots.append({"lap":number, "date":point.isoformat(), "drivers":tower, "weather":max(observed,key=lambda w:timestamp(w["date"])) if observed else None})
    return {"race":data["race"], "drivers":data["drivers"], "laps":data["laps"], "stints":data["stints"], "snapshots":snapshots}


@lru_cache(maxsize=8)
def cached_replay(path, modified):
    compact = resolve(path).with_name(resolve(path).stem + "-replay.json")
    if compact.exists():
        return json.loads(compact.read_text(encoding="utf-8"))
    return replay(_read(path, modified))


@lru_cache(maxsize=1)
def reference_frame(path, modified):
    frame = pd.read_csv(path)
    return frame[frame.eligible.eq(True)].copy()


def historical_reference(circuit, driver, team, compound):
    path = processed_dir() / "laps.csv"
    if not path.exists():
        raise HTTPException(503, "Historical feature dataset is not available.")
    frame = reference_frame(str(path), path.stat().st_mtime_ns)
    selected = frame[(frame.circuit == circuit) & (frame.driver == driver) &
                     (frame.team == team) & (frame.compound == compound)]
    sample = selected.iloc[::max(1, len(selected) // 180)].head(180)
    return {"source": "OpenF1", "lap_count": len(selected),
            "mean_lap_duration": float(selected.lap_duration.mean()) if len(selected) else None,
            "session_keys": sorted(int(key) for key in selected.session_key.unique()),
            "observations": sample[["session_key", "race_lap", "tyre_age", "lap_duration"]].to_dict(orient="records")}
