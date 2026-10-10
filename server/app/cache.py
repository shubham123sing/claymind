"""Content-addressed cache: the same request is never paid for twice.

Key = sha256 of (kind, provider, provider version, canonical request JSON).
JSON results and binary files (GLB) are stored under DATA_DIR/cache.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

CACHE_VERSION = 1


def cache_key(kind: str, provider: str, payload: Any) -> str:
    canon = json.dumps({"v": CACHE_VERSION, "k": kind, "p": provider, "d": payload}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()[:32]


class Cache:
    def __init__(self, root: Path):
        self.root = root / "cache"
        (self.root / "json").mkdir(parents=True, exist_ok=True)
        (self.root / "files").mkdir(parents=True, exist_ok=True)

    def get_json(self, key: str) -> dict | None:
        p = self.root / "json" / f"{key}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def put_json(self, key: str, value: dict) -> None:
        (self.root / "json" / f"{key}.json").write_text(json.dumps(value), "utf-8")

    def file_path(self, key: str, ext: str = "glb") -> Path:
        # keys are hex; never let a caller-supplied name escape the cache dir
        safe = "".join(c for c in key if c in "0123456789abcdef")[:64]
        return self.root / "files" / f"{safe}.{ext}"

    def has_file(self, key: str, ext: str = "glb") -> bool:
        return self.file_path(key, ext).exists()

    def put_file(self, key: str, data: bytes, ext: str = "glb") -> Path:
        p = self.file_path(key, ext)
        p.write_bytes(data)
        return p
