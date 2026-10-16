"""Provider interfaces. Adding a provider = implementing one of these and
registering it in providers/__init__.py (see docs/EXTENDING.md)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..schemas import DescribeRequest, DescribeResult


class VlmProvider(Protocol):
    name: str
    version: str

    async def describe(self, req: DescribeRequest) -> DescribeResult: ...


class ImageProvider(Protocol):
    name: str
    version: str

    async def refine(self, image_data_url: str, prompt: str) -> str:
        """Return a cleaner reference image (data URL or https URL)."""
        ...


@dataclass
class ModelProgress:
    status: str  # "running" | "done" | "error"
    progress: float  # 0..1
    glb: bytes | None = None
    error: str | None = None


class ModelProvider(Protocol):
    name: str
    version: str

    async def submit(self, image_data_url: str, category: str, name: str) -> str:
        """Start an image-to-3D job; returns a provider handle."""
        ...

    async def poll(self, handle: str) -> ModelProgress: ...


class ProviderError(Exception):
    """A provider failed; the client falls back to its local pipeline."""
