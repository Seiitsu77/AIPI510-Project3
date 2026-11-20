"""Audit the exact raw/processed race joins. No remote calls or fixture substitutions.

Run python -m pipeline.quality --session-keys 9472 9480 9488
Reports preserve all observed missingness; known invalid source rows are not invented.
"""
import argparse
from bisect import bisect_right
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from pipeline.ingest import ENDPOINTS, atomic_json
from pipeline.preprocess import timestamp
from pipeline.settings import config, resolve


def audit_session(raw_path, processed):
    load=lambda name:json.loads((raw_path/f"{name}.json").read_text(encoding="utf-8"))
    source={endpoint:load(endpoint) for endpoint in ENDPOINTS}
    session=load("session")
    rows=processed["laps"]
    failures=[]
    def check(condition,message):
        if not condition:failures.append(message)
    check(len(rows)==len(source["laps"]),"Lap-grain row count changed during joins")
    keys=Counter((row["driver_number"],row["lap_number"]) for row in source["laps"])
    duplicates=sum(count-1 for count in keys.values())
    sequence_gaps = {}
    for driver in source["drivers"]:
        numbers = {lap["lap_number"] for lap in source["laps"] if lap["driver_number"] == driver["driver_number"]}
        missing = sorted(set(range(min(numbers), max(numbers) + 1)) - numbers) if numbers else []
        if missing:
            sequence_gaps[str(driver["driver_number"])] = missing
    check(duplicates==0,"Duplicate source driver/lap keys")
    check(all(row["session_key"]==session["session_key"] for records in source.values() for row in records),"Endpoint includes a different session")
    drivers={d["driver_number"] for d in source["drivers"]}
    weather=sorted(source["weather"],key=lambda row:timestamp(row["date"]))
    dates=[timestamp(w["date"]) for w in weather]
    exact_stint=0;overlaps=0;missing_stint_valid=0;weather_matches=0;future=0;age_errors=0;null_weather=0
    processed_by_key={(r["driver_number"],r["race_lap"]):r for r in rows}
    for lap in source["laps"]:
        number=lap["driver_number"];n=lap["lap_number"]
        check(number in drivers,"Lap references missing driver")
        row=processed_by_key[(number,n)]
        matches=[s for s in source["stints"] if s["driver_number"]==number and s.get("lap_start") is not None and s.get("lap_end") is not None and s["lap_start"]<=n<=s["lap_end"]]
        overlaps+=len(matches)>1
        if len(matches) > 1:
            check(row["compound"] is None and row["tyre_age"] is None and not row["eligible"] and "ambiguous_stint" in row["exclusions"], "Ambiguous stint was silently assigned or eligible")
        exact_stint+=len(matches)==1
        missing_stint_valid+=not matches and lap.get("lap_duration") is not None
        if not matches:
            check(not row["eligible"] and row["compound"] is None, "Unmatched stint was silently assigned or eligible")
        if len(matches)==1:
            stint=matches[0]
            check(row["compound"]==stint.get("compound"),"Compound differs from matching raw stint")
            if stint.get("tyre_age_at_start") is not None:
                expected=n-stint["lap_start"]+stint["tyre_age_at_start"]
                age_errors+=row["tyre_age"]!=expected or expected<0
        start=timestamp(lap.get("date_start"))
        index=bisect_right(dates,start)-1 if start else -1
        actual=weather[index] if index>=0 and (start-dates[index]).total_seconds()<=300 else None
        if actual:
            weather_matches+=1
            future+=dates[index]>start
            check(row["track_temperature"]==actual.get("track_temperature"),"Weather temperature differs from raw backward match")
            check(row["rainfall"]==actual.get("rainfall"),"Rainfall differs from raw backward match")
            check(row["weather_age_seconds"]==(start-dates[index]).total_seconds(),"Weather age mismatch")
        else:
            null_weather+=1
            check(row["track_temperature"] is None,"Missing weather was invented")
    check(age_errors==0,"Tyre age formula mismatch or negative age")
    check(future==0,"Future weather leakage")
    check(all(not r["exclusions"] and r["lap_duration"] is not None for r in rows if r["eligible"]),"Invalid row eligible for training")
    coverage=lambda count:round(count/max(1,len(rows)),6)
    return {"session_key":session["session_key"],"location":session["location"],"year":session["year"],"source":"OpenF1","counts":{k:len(v) for k,v in source.items()},"processed_laps":len(rows),"eligible_laps":sum(r["eligible"] for r in rows),"duplicate_lap_keys":duplicates,"internal_missing_lap_count":sum(len(v) for v in sequence_gaps.values()),"internal_missing_laps_by_driver":sequence_gaps,"source_sequence_complete":not sequence_gaps,"exact_stint_matches":exact_stint,"stint_match_rate":coverage(exact_stint),"unmatched_stint_nonnull_duration_laps":missing_stint_valid,"unmatched_stint_null_duration_laps":len(rows)-exact_stint-overlaps-missing_stint_valid,"overlapping_stint_matches":overlaps,"tyre_age_errors":age_errors,"backward_weather_matches":weather_matches,"weather_match_rate":coverage(weather_matches),"missing_weather_laps":null_weather,"future_weather_matches":future,"weather_age_max_seconds":max((r["weather_age_seconds"] for r in rows if r["weather_age_seconds"] is not None),default=None),"null_lap_duration":sum(r["lap_duration"] is None for r in rows),"exclusions":dict(Counter(reason for r in rows for reason in r["exclusions"])),"observed_fields":{endpoint:sorted({key for row in records for key in row}) for endpoint,records in source.items()},"failures":sorted(set(failures)),"passed":not failures}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--session-keys",type=int,nargs="+")
    parser.add_argument("--output",default="docs/evidence/data-quality.json")
    args=parser.parse_args()
    cfg=config()["data"]
    raw,processed=resolve(cfg["raw_dir"]),resolve(cfg["processed_dir"])
    races=json.loads((processed/"races.json").read_text(encoding="utf-8"))
    if args.session_keys:races=[r for r in races if r["session_key"] in args.session_keys]
    if not races:raise ValueError("No ingested races to audit")
    reports=[]
    for race in races:
        key=race["session_key"]
        data=json.loads((processed/f"{key}.json").read_text(encoding="utf-8"))
        result=audit_session(raw/str(key),data)
        reports.append(result)
        print(json.dumps({"session_key": key, "location": race["location"], "passed": result["passed"], "laps": result["processed_laps"], "eligible": result["eligible_laps"], "failures": result["failures"]}, ensure_ascii=True), flush=True)
    dataset=json.loads((processed/"dataset.json").read_text(encoding="utf-8"))
    report={"audited_at":datetime.now(timezone.utc).isoformat(),"dataset_version":dataset["version"],"source_url":cfg["base_url"],"grain":"session_key + driver_number + race_lap","passed":all(r["passed"] for r in reports),"sessions":reports,"notes":["All observed source laps are preserved, including null-duration retirement rows. They remain ineligible for training.","Weather uses only observations at or before lap start, within 300 seconds.","Stint boundaries and tyre_age_at_start are reported by OpenF1; age is measured at lap start."]}
    atomic_json(resolve(args.output),report,indent=2)
    if not report["passed"]:raise SystemExit("Historical data quality gate failed; inspect report")

if __name__=="__main__":main()
