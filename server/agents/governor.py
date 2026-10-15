"""Quota governor (same idea as Story Theatre's): per-model request / token windows from
providers.json plus a circuit breaker, so the free tier is never overrun and a busy model
falls through to the next one in the chain."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class Window:
    limit: float | None
    seconds: float
    used: float = 0.0
    start: float = 0.0  # the first use rolls the window

    def roll(self, now: float) -> None:
        if now - self.start >= self.seconds:
            self.start, self.used = now, 0.0


@dataclass
class Bucket:
    rpm: Window
    tpm: Window
    rpd: Window
    tpd: Window
    open_until: float = 0.0
    failures: int = 0

    @classmethod
    def from_limits(cls, lim: dict) -> "Bucket":
        return cls(Window(lim.get("rpm"), 60), Window(lim.get("tpm"), 60), Window(lim.get("rpd"), 86400), Window(lim.get("tpd"), 86400))

    def windows(self, tokens: float):
        return ((self.rpm, 1), (self.rpd, 1), (self.tpm, tokens), (self.tpd, tokens))


class Governor:
    def __init__(self, chain: list[dict]):
        self._lock = threading.Lock()
        self._b = {p["id"]: Bucket.from_limits(p.get("limits", {})) for p in chain}

    def try_acquire(self, pid: str, est_tokens: int, now: float | None = None) -> bool:
        """Reserve one request and the estimated tokens, or False (try the next model)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            b = self._b[pid]
            if now < b.open_until:
                return False
            for w, amount in b.windows(est_tokens):
                w.roll(now)
                if w.limit is not None and w.used + amount > w.limit:
                    return False
            for w, amount in b.windows(est_tokens):
                w.used += amount
            return True

    def settle(self, pid: str, est_tokens: int, real_tokens: int) -> None:
        with self._lock:
            b = self._b[pid]
            for w in (b.tpm, b.tpd):
                w.used = max(0.0, w.used + real_tokens - est_tokens)
            b.failures = 0

    def fail(self, pid: str, retry_after: float | None = None, now: float | None = None) -> None:
        """429 / 5xx / timeout: open the breaker (server's retry-after, or 5 s doubling to 5 min)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            b = self._b[pid]
            b.failures += 1
            b.open_until = now + (retry_after if retry_after else min(300.0, 5.0 * 2 ** (b.failures - 1)))

    def snapshot(self) -> dict:
        now = time.monotonic()
        with self._lock:
            return {
                pid: {"rpm": [b.rpm.used, b.rpm.limit], "tpm": [b.tpm.used, b.tpm.limit], "rpd": [b.rpd.used, b.rpd.limit], "breakerOpenS": round(max(0.0, b.open_until - now), 1)}
                for pid, b in self._b.items()
            }
