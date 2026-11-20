"""Read-only HTTP verification of local or deployed historical/model endpoints."""
import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request(base,path,payload=None):
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(base.rstrip("/")+path,data=data,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=60) as response:
        return json.load(response)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-url",default="http://localhost:8000")
    parser.add_argument("--require-ready",action="store_true")
    parser.add_argument("--session-keys",type=int,nargs="+",default=[9472,9480,9488])
    parser.add_argument("--output",help="Save verification evidence as JSON")
    args=parser.parse_args()
    health=request(args.base_url,"/health")
    races=request(args.base_url,"/races")
    print(json.dumps({"health":health,"race_count":len(races)},indent=2))
    if args.require_ready and (len(races)<3 or not health["model_ready"]):
        raise SystemExit("Not ready: require at least three real races and a trained model")
    evidence={"verified_at":datetime.now(timezone.utc).isoformat(),"base_url":args.base_url,"health":health,"races":[]}
    indexed={race["session_key"]:race for race in races}
    for key in args.session_keys:
        if key not in indexed:
            if args.require_ready:raise SystemExit(f"Required historical session {key} is missing")
            continue
        race=indexed[key]
        replay=request(args.base_url,f"/races/{race['session_key']}/replay")
        assert replay["laps"] and replay["stints"] and replay["snapshots"]
        assert not replay["race"]["is_fixture"] and replay["race"]["source"]=="OpenF1"
        assert len(replay["snapshots"])==race["total_laps"]
        assert len(request(args.base_url,f"/races/{key}/laps"))==len(replay["laps"])
        assert len(request(args.base_url,f"/races/{key}/stints"))==len(replay["stints"])
        evidence["races"].append({"session_key":key,"location":race["location"],"laps":len(replay["laps"]),"stints":len(replay["stints"]),"total_laps":race["total_laps"],"observed":True})
        print("Historical replay OK:",race["location"],len(replay["laps"]),"laps")
    if health["model_ready"]:
        info=request(args.base_url,"/model/info")
        values=info.get("example_input") or {**info["combinations"][0],**{key:int(low) if key in {"tyre_age","race_lap","rainfall"} else low for key,(low,high) in info["ranges"].items()}}
        result=request(args.base_url,"/predict",values)
        assert result["model_version"]==info["version"] and result["lap_duration"]>0
        assert result["dataset_version"]==info["dataset_version"]
        batch=request(args.base_url,"/predict/batch",{"items":[values,values]})
        assert len(batch["predictions"])==2 and all(p==result for p in batch["predictions"])
        from urllib.parse import urlencode
        reference=request(args.base_url,"/reference?"+urlencode({key:values[key] for key in ("circuit","driver","team","compound")}))
        assert reference["source"]=="OpenF1" and reference["lap_count"]>0
        evidence["model"]={"version":info["version"],"dataset_version":info["dataset_version"],"algorithm":info["model"],"test_metrics":info["test_metrics"],"mlflow_run_id":info["mlflow_run_id"]}
        evidence["prediction"]={"input":values,"output":result,"batch_consistent":True,"historical_reference_laps":reference["lap_count"]}
        print("Prediction OK:",json.dumps(result))
    if args.output:
        path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(evidence,indent=2),encoding="utf-8")

if __name__=="__main__":
    main()
