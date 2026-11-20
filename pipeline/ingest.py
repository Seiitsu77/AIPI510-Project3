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

def atomic_json(path, data, indent=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, allow_nan=False, indent=indent), encoding="utf-8")
    temporary.replace(path)

def fetch(endpoint, params, path, cfg, refresh=False, client=None):
    if path.exists() and not refresh:
        return validate(endpoint, json.loads(path.read_text(encoding="utf-8")))
    token = os.getenv("OPENF1_TOKEN")
    headers = {"User-Agent": "F1PitWall/1.0 (historical academic research)"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(cfg["retries"]):
        try:
            get = client.get if client is not None else httpx.get
            response = get(f'{cfg["base_url"]}/{endpoint}', params=params, headers=headers, timeout=90)
            # OpenF1 uses this exact 404 for an empty historical result, e.g.
            # 2023 pit records. Preserve an explicit empty source result; do not
            # treat other 404s (bad routes, proxies) as a successful download.
            if response.status_code == 404 and response.json() == {"detail": "No results found."}:
                print(f"{endpoint} {params}: source returned no records", flush=True)
                atomic_json(path, [])
                time.sleep(cfg["request_delay"])
                return []
            if response.status_code in (401, 403):
                raise AccessRestricted("OpenF1 historical access restricted. Wait for the live session to end or configure OPENF1_TOKEN locally. No data has been fabricated.")
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == cfg["retries"] - 1:
                    response.raise_for_status()
                delay = max(1.0, float(response.headers.get("Retry-After", 2 ** (attempt + 1))))
                print(f"{endpoint}: HTTP {response.status_code}; retrying after {delay:g}s", flush=True)
                time.sleep(delay)
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

def upload_tree(directory, bucket_name, prefix, client=None):
    from google.cloud import storage
    from concurrent.futures import ThreadPoolExecutor
    bucket = (client or storage.Client()).bucket(bucket_name)
    files = [path for path in sorted(directory.rglob("*")) if path.is_file() and not path.name.endswith(".tmp") and path.name != ".gitkeep"]
    markers = {"dataset.json", "current.json", "manifest.json"}
    def upload(path):
        bucket.blob(f"{prefix}/{path.relative_to(directory).as_posix()}").upload_from_filename(str(path))
    # Independent objects can upload concurrently, but publish manifests/pointers
    # only after all their referenced content is present.
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(upload, [p for p in files if p.name not in markers]))
    for path in files:
        if path.name in markers:
            upload(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="Three configured completed races")
    parser.add_argument("--all", action="store_true", help="All completed race sessions in configured years")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--session-keys", type=int, nargs="+", help="Explicit completed race subset, after year selection")
    args = parser.parse_args()
    cfg = config()["data"]
    with httpx.Client(timeout=90) as client:
        ingest_sessions(args, cfg, client)


def ingest_sessions(args, cfg, client):
    raw = resolve(cfg["raw_dir"])
    years = [cfg["demo_year"]] if args.demo or not args.all else cfg["years"]
    sessions = []
    for year in years:
        sessions.extend(fetch("sessions", {"year": year, "session_name": "Race"}, raw / f"sessions-{year}.json", cfg, args.refresh, client=client))
    now = datetime.now(timezone.utc)
    sessions = [s for s in sessions if datetime.fromisoformat(s["date_end"]) < now]
    sessions = [s for s in sessions if not s.get("is_cancelled", False)]
    if args.demo or not args.all:
        sessions = [s for s in sessions if s["location"] in cfg["demo_locations"]]
        if len(sessions) != 3:
            raise ValueError("Expected three demo locations; inspect cached session metadata and config.yaml")
    if args.session_keys:
        sessions = [s for s in sessions if s["session_key"] in args.session_keys]
        if {s["session_key"] for s in sessions} != set(args.session_keys):
            raise ValueError("Requested session key was not found among selected completed races")
    for session in sorted(sessions, key=lambda s: s["date_start"]):
        directory = raw / str(session["session_key"])
        atomic_json(directory / "session.json", session)
        counts = {}
        for endpoint in ENDPOINTS:
            counts[endpoint] = len(fetch(endpoint, {"session_key": session["session_key"]}, directory / f"{endpoint}.json", cfg, args.refresh, client=client))
        if any(counts[name] == 0 for name in ("drivers", "laps", "stints")):
            raise ValueError(f"Session {session['session_key']} lacks required driver/lap/stint records; not marked complete")
        atomic_json(directory / "manifest.json", {"source": cfg["base_url"], "retrieved_at": now.isoformat(), "counts": counts,
                    "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.glob("*.json") if p.name != "manifest.json"}})
        # JSON logging also works on Windows consoles using a legacy code page.
        print(json.dumps({"location": session["location"], "session_key": session["session_key"], "counts": counts}, ensure_ascii=True), flush=True)
    if args.upload:
        bucket = os.getenv("GCS_BUCKET") or cfg["gcs_bucket"]
        if not bucket:
            raise ValueError("Set GCS_BUCKET or data.gcs_bucket")
        stamp = now.strftime("%Y%m%dT%H%M%SZ")
        upload_tree(raw, bucket, f'{cfg["gcs_prefix"]}/raw/{stamp}')

if __name__ == "__main__":
    main()
