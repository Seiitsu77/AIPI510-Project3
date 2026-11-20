"""Versioned cloud publication using ADC, or an explicitly selected gcloud session.

No token is ever persisted or printed. All operations verify the dedicated project
and bucket; the current gcloud default project is never changed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import subprocess
from pathlib import Path
from google.cloud import storage
from google.oauth2.credentials import Credentials
from pipeline.ingest import upload_tree, atomic_json
from pipeline.settings import config, resolve

PROJECT="f1-pitwall-2026-qh719"
PROJECT_NUMBER="649091037888"
BUCKET="f1-pitwall-2026-qh719-data"


def gcloud(*args):
    import shutil
    command=shutil.which("gcloud.cmd") or shutil.which("gcloud")
    if not command:raise RuntimeError("gcloud is not installed; use Application Default Credentials instead")
    return subprocess.run([command,*args],capture_output=True,text=True,check=True).stdout.strip()


def verify_project():
    actual=json.loads(gcloud("projects","describe",PROJECT,"--project="+PROJECT,"--format=json"))
    if actual["projectId"]!=PROJECT or actual["projectNumber"]!=PROJECT_NUMBER:
        raise RuntimeError("Dedicated F1 PitWall project identity does not match")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--gcloud-auth",action="store_true",help="Use the already signed-in gcloud account in memory instead of ADC")
    parser.add_argument("--include-raw",action="store_true")
    parser.add_argument("--include-model",action="store_true")
    parser.add_argument("--model-only", action="store_true", help="Publish the trained model/MLflow backup without re-uploading an already verified dataset")
    args=parser.parse_args()
    verify_project()
    cfg=config()
    if cfg["data"].get("gcs_bucket")!=BUCKET:raise ValueError("Configured bucket must be the approved dedicated bucket")
    credentials=None
    if args.gcloud_auth:
        credentials=Credentials(gcloud("auth","print-access-token"))
    client=storage.Client(project=PROJECT,credentials=credentials)
    bucket=client.bucket(BUCKET)
    bucket.reload()
    if str(bucket.project_number)!=PROJECT_NUMBER:raise RuntimeError("GCS bucket belongs to another project")
    processed=resolve(cfg["data"]["processed_dir"])
    manifest=json.loads((processed/"dataset.json").read_text(encoding="utf-8"))
    if manifest["source"]!="OpenF1":raise ValueError("Only actual OpenF1 records may be published as a dataset")
    for name,digest in manifest["processed_sha256"].items():
        if hashlib.sha256((processed/name).read_bytes()).hexdigest()!=digest:
            raise ValueError(f"Processed artifact changed: {name}")
    prefix=f"{cfg['data']['gcs_prefix']}/processed/{manifest['version']}"
    if not args.model_only:
        upload_tree(processed,BUCKET,prefix,client=client)
    # Download exact cloud CSV bytes to verify what training would consume.
    cloud_hash=hashlib.sha256(bucket.blob(prefix+"/laps.csv").download_as_bytes()).hexdigest()
    if cloud_hash!=manifest["csv_sha256"]:raise RuntimeError("Cloud training CSV checksum mismatch")
    receipt={"project_id":PROJECT,"bucket":BUCKET,"dataset_version":manifest["version"],"processed_uri":f"gs://{BUCKET}/{prefix}","csv_sha256_verified":cloud_hash,"published_at":datetime.now(timezone.utc).isoformat()}
    previous_path = resolve("docs/evidence/gcs-publication.json")
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
        if previous.get("dataset_version") == manifest["version"] and previous.get("raw_uri"):
            receipt["raw_uri"] = previous["raw_uri"]
    if args.include_raw:
        stamp=receipt["published_at"].replace(":","").replace("+","")
        raw_prefix=f"{cfg['data']['gcs_prefix']}/raw/{stamp}"
        upload_tree(resolve(cfg["data"]["raw_dir"]),BUCKET,raw_prefix,client=client)
        receipt["raw_uri"]=f"gs://{BUCKET}/{raw_prefix}"
    if args.include_model or args.model_only:
        artifacts=resolve(cfg["model"]["artifact_dir"])
        pointer=json.loads((artifacts/"current.json").read_text(encoding="utf-8"))
        info=json.loads((artifacts/"model-info.json").read_text(encoding="utf-8"))
        if info["dataset_version"] != manifest["version"] or info["version"] != pointer["version"]:
            raise ValueError("Model and dataset versions do not match; refusing to publish a mixed release")
        model_prefix=f"{cfg['data']['gcs_prefix']}/models/{pointer['version']}"
        upload_tree(artifacts,BUCKET,model_prefix,client=client)
        receipt["model_uri"]=f"gs://{BUCKET}/{model_prefix}"
        receipt["model_version"]=pointer["version"]
        receipt["model_sha256"]=hashlib.sha256((artifacts/pointer["file"]).read_bytes()).hexdigest()
        # Persist the full experiment store separately from deployment data.
        run_prefix=f"{cfg['data']['gcs_prefix']}/experiments/{pointer['version']}"
        upload_tree(resolve("mlruns"),BUCKET,run_prefix+"/artifacts",client=client)
        tracking=resolve("mlflow.db")
        if tracking.exists():bucket.blob(run_prefix+"/mlflow.db").upload_from_filename(str(tracking))
        receipt["mlflow_uri"]=f"gs://{BUCKET}/{run_prefix}"
    atomic_json(resolve("docs/evidence/gcs-publication.json"),receipt,indent=2)
    print(json.dumps(receipt,indent=2))

if __name__=="__main__":main()
