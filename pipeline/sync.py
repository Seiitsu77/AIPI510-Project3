"""Download an immutable, versioned processed dataset from GCS for training or serving."""
import argparse
import hashlib
import json
import os
import re
from google.cloud import storage
from pipeline.settings import config, resolve


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--dataset-version",required=True)
    parser.add_argument("--gcloud-auth", action="store_true", help="Use the signed-in gcloud account in memory")
    parser.add_argument("--training-only", action="store_true", help="Restore verified CSV, race list and manifest without replay payloads")
    args=parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{16}",args.dataset_version):
        raise ValueError("Expected the exact 16-character dataset version from preprocessing")
    cfg=config()["data"]
    bucket_name=os.getenv("GCS_BUCKET") or cfg["gcs_bucket"]
    if not bucket_name:
        raise ValueError("Set GCS_BUCKET")
    credentials = None
    if args.gcloud_auth:
        from pipeline.gcs import verify_project, gcloud, PROJECT, BUCKET
        from google.oauth2.credentials import Credentials
        verify_project()
        if bucket_name != BUCKET:
            raise ValueError("gcloud authentication is limited to the approved F1 PitWall bucket")
        credentials = Credentials(gcloud("auth", "print-access-token"))
    bucket=storage.Client(project="f1-pitwall-2026-qh719", credentials=credentials).bucket(bucket_name)
    prefix=f"{cfg['gcs_prefix']}/processed/{args.dataset_version}"
    output=resolve(cfg["processed_dir"])
    output.mkdir(parents=True,exist_ok=True)
    # Only known filenames, never paths supplied by storage object names.
    manifest=json.loads(bucket.blob(f"{prefix}/dataset.json").download_as_text())
    if manifest["source"]!="OpenF1" or manifest["version"]!=args.dataset_version:
        raise ValueError("Dataset provenance/version mismatch")
    names = ["laps.csv", "races.json"]
    if not args.training_only:
        for key in manifest["session_keys"]:
            names.extend([f"{int(key)}.json", f"{int(key)}-replay.json"])
    for name in names:
        temporary=output/f"{name}.tmp"
        bucket.blob(f"{prefix}/{name}").download_to_filename(str(temporary))
        expected = manifest.get("processed_sha256", {}).get(name)
        if expected and hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
            raise ValueError("GCS dataset checksum mismatch")
        temporary.replace(output/name)
    from pipeline.ingest import atomic_json
    atomic_json(output/"dataset.json",manifest)
    print(f"Downloaded verified OpenF1 dataset {args.dataset_version}")

if __name__=="__main__":
    main()
