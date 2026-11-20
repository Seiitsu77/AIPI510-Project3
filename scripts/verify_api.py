"""Read-only HTTP verification of local or deployed historical/model endpoints."""
import argparse
import json
import urllib.request


def request(base,path,payload=None):
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(base.rstrip("/")+path,data=data,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=60) as response:
        return json.load(response)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-url",default="http://localhost:8000")
    parser.add_argument("--require-ready",action="store_true")
    args=parser.parse_args()
    health=request(args.base_url,"/health")
    races=request(args.base_url,"/races")
    print(json.dumps({"health":health,"race_count":len(races)},indent=2))
    if args.require_ready and (len(races)<3 or not health["model_ready"]):
        raise SystemExit("Not ready: require at least three real races and a trained model")
    for race in races[:3]:
        replay=request(args.base_url,f"/races/{race['session_key']}/replay")
        assert replay["laps"] and replay["stints"] and replay["snapshots"]
        print("Historical replay OK:",race["location"],len(replay["laps"]),"laps")
    if health["model_ready"]:
        info=request(args.base_url,"/model/info")
        values={**info["combinations"][0],**{key:int(low) if key in {"tyre_age","race_lap","rainfall"} else low for key,(low,high) in info["ranges"].items()}}
        result=request(args.base_url,"/predict",values)
        assert result["model_version"]==info["version"] and result["lap_duration"]>0
        print("Prediction OK:",json.dumps(result))

if __name__=="__main__":
    main()
