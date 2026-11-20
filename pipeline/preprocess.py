"""Build lap-level features with backward-only weather joins and explicit exclusions."""
import argparse
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import pandas as pd
from pipeline.ingest import ENDPOINTS, atomic_json, upload_tree
from pipeline.schemas import validate
from pipeline.settings import config, resolve
import os


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def latest_before(rows, point):
    if point is None or not rows:
        return None
    # Callers pre-sort once. Never borrow a weather observation from the future.
    index = bisect_right([timestamp(r["date"]) for r in rows], point) - 1
    if index < 0:
        return None
    row = rows[index]
    return row if point - timestamp(row["date"]) <= timedelta(minutes=5) else None


def caution_windows(control, session_end):
    windows, active = [], {}
    for event in sorted(control, key=lambda r: r["date"]):
        date = timestamp(event["date"])
        text = event["message"].upper()
        category = event["category"].upper()
        flag = (event.get("flag") or "").upper()
        scope = (event.get("scope") or "").upper()
        if category == "SAFETYCAR":
            if "DEPLOYED" in text or "VSC" in text and "ENDING" not in text:
                active.setdefault("sc", date)
            if "IN THIS LAP" in text or "ENDING" in text:
                start = active.pop("sc", date - timedelta(minutes=2))
                windows.append((start, date + timedelta(seconds=120)))
        if flag in {"RED", "YELLOW", "DOUBLE YELLOW"} and scope in {"TRACK", "SECTOR", ""}:
            active.setdefault("flag", date)
        if flag in {"GREEN", "CLEAR"}:
            start = active.pop("flag", None)
            if start:
                windows.append((start, date + timedelta(seconds=10)))
    windows.extend((start, session_end) for start in active.values())
    return windows


def process_session(session, source, cfg):
    drivers = {d["driver_number"]: d for d in source["drivers"]}
    stints = source["stints"]
    weather = sorted(source["weather"], key=lambda w: w["date"])
    windows = caution_windows(source["race_control"], timestamp(session["date_end"]))
    deleted = {(e.get("driver_number"), e.get("lap_number")) for e in source["race_control"] if "DELETED" in e["message"].upper()}
    rows = []
    for lap in source["laps"]:
        driver = drivers.get(lap["driver_number"])
        if driver is None:
            raise ValueError(f"Missing driver metadata: {lap['driver_number']}")
        number = lap["lap_number"]
        stint = next((s for s in stints if s["driver_number"] == lap["driver_number"] and s.get("lap_start") is not None and s.get("lap_end") is not None and s["lap_start"] <= number <= s["lap_end"]), None)
        start = timestamp(lap.get("date_start"))
        duration = lap.get("lap_duration")
        end = start + timedelta(seconds=duration) if start and duration is not None and math.isfinite(duration) else None
        observation = latest_before(weather, start)
        weather_age = (start - timestamp(observation["date"])).total_seconds() if observation else None
        is_pit = bool(lap.get("is_pit_out_lap")) or bool(stint and number == stint["lap_end"] and any(s["driver_number"] == lap["driver_number"] and s["stint_number"] > stint["stint_number"] for s in stints))
        is_pit = is_pit or any(p["driver_number"] == lap["driver_number"] and (p.get("lap_number") == number or start and end and start <= timestamp(p["date"]) <= end) for p in source["pit"])
        reasons = []
        if not duration or not math.isfinite(duration) or not cfg["minimum_lap_seconds"] <= duration <= cfg["maximum_lap_seconds"]:
            reasons.append("invalid_duration")
        if number == 1:
            reasons.append("standing_start")
        if not start:
            reasons.append("missing_timestamp")
        if is_pit:
            reasons.append("pit_lap")
        if start and end and any(start <= b and end >= a for a,b in windows):
            reasons.append("caution")
        if (lap["driver_number"], number) in deleted:
            reasons.append("deleted_lap")
        if not stint or stint.get("compound") not in {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}:
            reasons.append("unknown_stint")
        if stint and stint.get("tyre_age_at_start") is None:
            reasons.append("unknown_tyre_age")
        if not observation or observation.get("track_temperature") is None or observation.get("rainfall") is None:
            reasons.append("missing_weather")
        if cfg["exclude_wet"] and observation and observation.get("rainfall") != 0:
            reasons.append("wet_conditions")
        if cfg["exclude_wet"] and stint and stint.get("compound") in {"WET", "INTERMEDIATE"}:
            reasons.append("wet_tyre")
        age = number - stint["lap_start"] + stint["tyre_age_at_start"] if stint and stint.get("tyre_age_at_start") is not None else None
        rows.append({"session_key": session["session_key"], "session_date": session["date_start"], "circuit": session["circuit_short_name"],
                     "driver": driver["name_acronym"], "driver_number": lap["driver_number"], "team": driver["team_name"],
                     "compound": stint.get("compound") if stint else None, "tyre_age": age, "race_lap": number,
                     "track_temperature": observation.get("track_temperature") if observation else None,
                     "rainfall": observation.get("rainfall") if observation else None, "weather_age_seconds": weather_age,
                     "lap_duration": duration, "date_start": lap.get("date_start"), "date_end": end.isoformat() if end else None,
                     "is_pit_lap": bool(is_pit), "exclusions": reasons, "eligible": not reasons})
    # Target-based QC only: these values never enter the predictor columns.
    frame = pd.DataFrame(rows)
    for driver_number in frame.driver_number.unique():
        candidates = frame[(frame.driver_number == driver_number) & frame.eligible]
        if len(candidates) >= 10:
            median = candidates.lap_duration.median()
            for row in rows:
                if row["driver_number"] == driver_number and row["eligible"] and not median * .85 <= row["lap_duration"] <= median * 1.15:
                    row["exclusions"].append("pace_outlier")
                    row["eligible"] = False
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    settings = config()
    raw, output = resolve(settings["data"]["raw_dir"]), resolve(settings["data"]["processed_dir"])
    rows, races, hashes = [], [], {}
    for path in sorted(raw.glob("*/session.json")):
        # A partially downloaded race must never become a processed dataset.
        if not (path.parent / "manifest.json").exists():
            print("Skipping incomplete session", path.parent.name)
            continue
        raw_manifest = json.loads((path.parent / "manifest.json").read_text(encoding="utf-8"))
        for name, digest in raw_manifest["sha256"].items():
            if hashlib.sha256((path.parent / name).read_bytes()).hexdigest() != digest:
                raise ValueError(f"Raw cache integrity failed: {path.parent.name}/{name}; re-ingest the session.")
        session = json.loads(path.read_text(encoding="utf-8"))
        validate("sessions", [session])
        source = {name: validate(name, json.loads((path.parent / f"{name}.json").read_text())) for name in ENDPOINTS}
        session_rows = process_session(session, source, settings["evaluation"])
        if not session_rows:
            continue
        rows.extend(session_rows)
        races.append({**session, "total_laps": max(r["race_lap"] for r in session_rows), "source": "OpenF1", "is_fixture": False})
        atomic_json(output / f'{session["session_key"]}.json', {"race": races[-1], "laps": session_rows, **{k:source[k] for k in ("drivers", "stints", "position", "intervals", "weather", "race_control")}})
        for p in path.parent.glob("*.json"):
            if p.name == "manifest.json":
                continue
            hashes[f"{path.parent.name}/{p.name}"] = hashlib.sha256(p.read_bytes()).hexdigest()
    if not rows:
        raise ValueError("No complete historical sessions. Run python -m pipeline.ingest --demo first.")
    version = hashlib.sha256(json.dumps({"raw": hashes, "evaluation": settings["evaluation"], "preprocess_code": hashlib.sha256(resolve("pipeline/preprocess.py").read_bytes()).hexdigest()}, sort_keys=True).encode()).hexdigest()[:16]
    output.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(rows)
    frame["exclusions"] = frame["exclusions"].map(lambda r: "|".join(r))
    frame.to_csv(output / "laps.csv", index=False)
    atomic_json(output / "races.json", races)
    atomic_json(output / "dataset.json", {"version": version, "source": "OpenF1", "created_at": datetime.now(timezone.utc).isoformat(), "csv_sha256": hashlib.sha256((output / "laps.csv").read_bytes()).hexdigest(), "rows": len(rows), "eligible_rows": int(frame.eligible.sum()), "session_keys": [r["session_key"] for r in races], "raw_sha256": hashes, "config": settings["evaluation"]})
    print(f"Dataset {version}: {len(rows)} laps, {frame.eligible.sum()} eligible, {len(races)} races")
    if args.upload:
        bucket = os.getenv("GCS_BUCKET") or settings["data"]["gcs_bucket"]
        if not bucket:
            raise ValueError("Set GCS_BUCKET")
        upload_tree(output, bucket, f'{settings["data"]["gcs_prefix"]}/processed/{version}')

if __name__ == "__main__":
    main()
