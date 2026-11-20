from pathlib import Path
import os
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

def config():
    path = Path(os.getenv("CONFIG_PATH", str(ROOT / "config.yaml")))
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)

def resolve(path):
    value = Path(path)
    return value if value.is_absolute() else ROOT / value
