"""Abuse and cost guards: input size limits, per-session quotas, a global spend cap.

Spend is an estimate (configured cost per call) persisted to DATA_DIR/spend.json,
so a restart does not reset the cap. Mock providers cost nothing.
"""
from __future__ import annotations

import base64
import json
import threading
import time
from collections import defaultdict
from pathlib import Path

from fastapi import HTTPException

from .config import Settings


def decode_data_url(data_url: str, max_bytes: int, allowed=("image/png", "image/jpeg", "image/webp")) -> tuple[str, bytes]:
    if not data_url.startswith("data:") or ";base64," not in data_url:
        raise HTTPException(400, "image must be a base64 data URL")
    head, b64 = data_url.split(";base64,", 1)
    mime = head[5:]
    if mime not in allowed:
        raise HTTPException(415, f"unsupported image type {mime}")
    if len(b64) * 3 / 4 > max_bytes * 1.01:
        raise HTTPException(413, "image too large")
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception as e:  # noqa: BLE001 - any decode failure is a bad request
        raise HTTPException(400, "invalid base64") from e
    if len(raw) > max_bytes:
        raise HTTPException(413, "image too large")
    return mime, raw


class Guards:
    def __init__(self, s: Settings):
        self.s = s
        self._lock = threading.Lock()
        self._counts: dict[tuple[str, str], int] = defaultdict(int)
        self._spend_file: Path = s.data_dir / "spend.json"
        s.data_dir.mkdir(parents=True, exist_ok=True)
        self._spend = self._load_spend()

    def _load_spend(self) -> dict:
        month = time.strftime("%Y-%m")
        try:
            d = json.loads(self._spend_file.read_text("utf-8"))
            if d.get("month") == month:
                return d
        except (OSError, json.JSONDecodeError):
            pass
        return {"month": month, "usd": 0.0}

    @property
    def spend_usd(self) -> float:
        return round(self._spend["usd"], 4)

    def check(self, session: str, kind: str, cost: float, limit: int) -> None:
        """Raise 429 / 402 before doing billable work."""
        with self._lock:
            if self._counts[(session, kind)] >= limit:
                raise HTTPException(429, f"session limit reached for {kind}")
            if cost > 0 and self._spend["usd"] + cost > self.s.spend_cap_usd:
                raise HTTPException(402, "global AI spending cap reached")

    def charge(self, session: str, kind: str, cost: float) -> None:
        with self._lock:
            self._counts[(session, kind)] += 1
            if cost > 0:
                self._spend = self._load_spend()
                self._spend["usd"] += cost
                self._spend_file.write_text(json.dumps(self._spend), "utf-8")
