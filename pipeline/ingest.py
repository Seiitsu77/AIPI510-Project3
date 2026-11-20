"""Cached, resumable OpenF1 ingestion. Run: python -m pipeline.ingest --demo"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
import httpx
from pipeline.schemas import validate
from pipeline.settings import config, resolve

ENDPOINTS = ("drivers", "laps", "stints", "weather", "position", "intervals", "pit", "race_control")

class AccessRestricted(RuntimeError):
    pass

def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, allow_nan=False), encoding="utf-8")
    temporary.replace(path)

def fetch(endpoint, params, path, cfg, refresh=False):
    if path.exists() and not refresh:
        return validate(endpoint, json.loads(path.read_text(encoding="utf-8")))
    token = os.getenv("OPENF1_TOKEN")
    headers = {"User-Agent": "F1PitWall/1.0 (historical academic research)"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(cfg["retries"]):
        try:
            response = httpx.get(f'{cfg["base_url"]}/{endpoint}', params=params, headers=headers, timeout=90)
            if response.status_code in (401, 403):
                raise AccessRestricted("OpenF1 historical access restricted. Wait for the live session to end or configure OPENF1_TOKEN locally. No data has been fabricated.")
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == cfg["retries"] - 1:
                    response.raise_for_status()
                time.sleep(min(float(response.headers.get("Retry-After", 2 ** (attempt + 1))), 45))
                continue
            response.raise_for_status()
            data = validate(endpoint, response.json())
            atomic_json(path, data)
            time.sleep(cfg["request_delay"])
            return data
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == cfg["retries"] - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Unable to fetch {endpoint}")

def upload_tree(directory, bucket_name, prefix):
    from google.cloud import storage
    bucket = storage.Client().bucket(bucket_name)
    for path in sorted(directory.rglob("*")):
        if path.is_file() and not path.name.endswith(".tmp"):
            bucket.blob(f"{prefix}/{path.relative_to(directory).as_posix()}").upload_from_filename(str(path))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="Three configured completed races")
    parser.add_argument("--all", action="store_true", help="All completed race sessions in configured years")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    cfg = config()["data"]
    raw = resolve(cfg["raw_dir"])
    years = [cfg["demo_year"]] if args.demo or not args.all else cfg["years"]
    sessions = []
    for year in years:
        sessions.extend(fetch("sessions", {"year": year, "session_name": "Race"}, raw / f"sessions-{year}.json", cfg, args.refresh))
    now = datetime.now(timezone.utc)
    sessions = [s for s in sessions if datetime.fromisoformat(s["date_end"]) < now]
    if args.demo or not args.all:
        sessions = [s for s in sessions if s["location"] in cfg["demo_locations"]]
        if len(sessions) != 3:
            raise ValueError("Expected three demo locations; inspect cached session metadata and config.yaml")
    for session in sorted(sessions, key=lambda s: s["date_start"]):
        directory = raw / str(session["session_key"])
        atomic_json(directory / "session.json", session)
        counts = {}
        for endpoint in ENDPOINTS:
            counts[endpoint] = len(fetch(endpoint, {"session_key": session["session_key"]}, directory / f"{endpoint}.json", cfg, args.refresh))
        atomic_json(directory / "manifest.json", {"source": cfg["base_url"], "retrieved_at": now.isoformat(), "counts": counts,
                    "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.glob("*.json") if p.name != "manifest.json"}})
        print(session["location"], session["session_key"], counts)
    if args.upload:
        bucket = os.getenv("GCS_BUCKET") or cfg["gcs_bucket"]
        if not bucket:
            raise ValueError("Set GCS_BUCKET or data.gcs_bucket")
        stamp = now.strftime("%Y%m%dT%H%M%SZ")
        upload_tree(raw, bucket, f'{cfg["gcs_prefix"]}/raw/{stamp}')

if __name__ == "__main__":
    main()
