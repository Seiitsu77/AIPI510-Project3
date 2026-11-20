import json
import pytest
from pipeline import gcs
from pipeline.ingest import upload_tree


def test_project_guard_rejects_anime_compass_before_any_write(monkeypatch):
    monkeypatch.setattr(gcs,"gcloud",lambda *args:json.dumps({"projectId":"project-4ea00490-f490-4348-86b","projectNumber":"wrong"}))
    with pytest.raises(RuntimeError,match="identity"):gcs.verify_project()


def test_project_guard_accepts_only_the_expected_id_and_number(monkeypatch):
    monkeypatch.setattr(gcs,"gcloud",lambda *args:json.dumps({"projectId":gcs.PROJECT,"projectNumber":gcs.PROJECT_NUMBER}))
    gcs.verify_project()


def test_upload_helper_uses_the_explicit_client_and_skips_incomplete_files(tmp_path):
    (tmp_path/"laps.csv").write_text("lap,duration\n2,90\n")
    (tmp_path/"laps.csv.tmp").write_text("incomplete")
    calls=[]
    class Blob:
        def __init__(self,name):self.name=name
        def upload_from_filename(self,path):calls.append((self.name,path))
    class Bucket:
        def blob(self,name):return Blob(name)
    class Client:
        def bucket(self,name):
            assert name==gcs.BUCKET
            return Bucket()
    upload_tree(tmp_path,gcs.BUCKET,"processed/test",client=Client())
    assert len(calls)==1 and calls[0][0]=="processed/test/laps.csv"
