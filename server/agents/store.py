"""Small persistence for the agent backend: a response cache keyed by input hash (SQLite),
the agent-activity trace (ring buffer), and the current-agent label for the trace."""

from __future__ import annotations

import contextvars
import hashlib
import json
import sqlite3
import threading
import time
from collections import deque
from pathlib import Path

#: which agent a model call belongs to (set by the agent runner; read by the governed model)
current_agent: contextvars.ContextVar[str] = contextvars.ContextVar("current_agent", default="?")


def input_hash(*parts: object) -> str:
    raw = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class Cache:
    """Answers by input hash. Only validated answers go in."""

    def __init__(self, path: Path):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, kind TEXT, v TEXT, at REAL)")
        self._db.commit()

    def get(self, key: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT v FROM cache WHERE k = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key: str, kind: str, value: dict) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?)", (key, kind, json.dumps(value, ensure_ascii=False), time.time()))
            self._db.commit()

    def by_kind(self, kind: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT v FROM cache WHERE kind = ? ORDER BY at DESC", (kind,)).fetchall()
        return [json.loads(r[0]) for r in rows]


class Trace:
    """Last N agent calls: agent, model, tokens, ms, cached, ok."""

    def __init__(self, size: int = 200):
        self._items: deque[dict] = deque(maxlen=size)
        self._lock = threading.Lock()

    def add(self, **entry: object) -> None:
        entry.setdefault("at", round(time.time(), 3))
        with self._lock:
            self._items.append(entry)

    def list(self) -> list[dict]:
        with self._lock:
            return list(self._items)
