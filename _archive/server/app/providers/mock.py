"""Mock providers: realistic shapes and latencies, zero cost, no network.

The mock VLM cannot see images; it answers from the client's local hints
(best template match, open top, holes) with some uncertainty, so the rest of
the pipeline (KG edges, waiting UI, caching) is exercised exactly like the
real thing. The mock image-to-3D returns a pre-baked sample GLB for known
categories (server/samples/<category>.glb) and fails otherwise, which tests
the client's fallback path.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from pathlib import Path

from ..schemas import DescribeRequest, DescribeResult, MaterialGuess
from .base import ModelProgress, ProviderError

# typical materials per category (mirrors template priors; mock only)
_TYPICAL = {
    "mug": ["glass", "plastic", "steel"],
    "bowl": ["glass", "wood", "plastic"],
    "plate": ["glass", "plastic", "wood"],
    "vase": ["glass", "stone", "clay"],
    "bottle": ["glass", "plastic", "steel"],
    "can": ["steel", "plastic"],
    "ball": ["rubber", "plastic", "foam"],
    "block": ["wood", "plastic", "stone"],
    "ring": ["rubber", "foam", "plastic"],
    "plank": ["wood", "steel", "plastic"],
}


def _jitter(seed: str, scale: float) -> float:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return ((h % 1000) / 1000 - 0.5) * scale


class MockVlm:
    name = "mock-vlm"
    version = "1"

    def __init__(self, seconds: float):
        self.seconds = seconds

    async def describe(self, req: DescribeRequest) -> DescribeResult:
        await asyncio.sleep(self.seconds)
        h = req.hints
        seed = req.images[0][-64:]
        cat = h.best_template if h.best_template and h.best_similarity >= 0.35 else None
        if cat is None:
            cat = "bowl" if h.open_top > 0.55 else "ring" if h.holes >= 1 else "sculpture"
        conf = max(0.3, min(0.95, (h.best_similarity or 0.4) + 0.15 + _jitter(seed, 0.1)))
        typical = [m for m in _TYPICAL.get(cat, ["clay", "stone", "plastic"]) if m in req.materials] or req.materials[:3]
        probs = [0.62 + _jitter(seed + "m", 0.2), 0.24, 0.14][: len(typical)]
        name = cat.capitalize() if cat != "sculpture" else "Sculpture"
        return DescribeResult(
            name=name,
            category=cat,
            confidence=round(conf, 3),
            material=[MaterialGuess(name=m, prob=max(0.01, p)) for m, p in zip(typical, probs)],
            parts=["body", "handle"] if cat == "mug" else ["body"],
            notes="mock answer from local shape hints",
        )


class MockImage:
    name = "mock-image"
    version = "1"

    async def refine(self, image_data_url: str, prompt: str) -> str:
        await asyncio.sleep(0.4)
        return image_data_url  # pass-through


class MockModel:
    name = "mock-model"
    version = "1"

    def __init__(self, seconds: float, samples: Path):
        self.seconds = seconds
        self.samples = samples
        self._jobs: dict[str, tuple[float, str]] = {}

    async def submit(self, image_data_url: str, category: str, name: str) -> str:
        handle = hashlib.sha256(f"{time.time()}{category}".encode()).hexdigest()[:16]
        self._jobs[handle] = (time.time(), category)
        return handle

    async def poll(self, handle: str) -> ModelProgress:
        if handle not in self._jobs:
            raise ProviderError("unknown job")
        t0, cat = self._jobs[handle]
        p = (time.time() - t0) / max(0.1, self.seconds)
        if p < 1:
            return ModelProgress("running", round(p, 3))
        sample = self.samples / f"{cat}.glb"
        if not sample.exists():
            return ModelProgress("error", 1.0, error=f"no sample model for '{cat}' (mock)")
        return ModelProgress("done", 1.0, glb=sample.read_bytes())
