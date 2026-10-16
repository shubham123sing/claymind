"""Server settings from environment variables (see server/.env.example).

Keys never leave the server. Provider names and model ids live here (env),
never in game logic.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    # providers: "mock" | "anthropic" (vlm) | "fal" (image / model) | "none"
    vlm_provider: str = field(default_factory=lambda: os.environ.get("VLM_PROVIDER", "mock"))
    image_provider: str = field(default_factory=lambda: os.environ.get("IMAGE_PROVIDER", "mock"))
    model_provider: str = field(default_factory=lambda: os.environ.get("MODEL_PROVIDER", "mock"))

    anthropic_model: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_EFFORT", "low"))

    fal_key: str | None = field(default_factory=lambda: os.environ.get("FAL_KEY"))
    # fal model ids are configurable because hosted model names change; verify on fal.ai before use
    fal_image_model: str = field(default_factory=lambda: os.environ.get("FAL_IMAGE_MODEL", "fal-ai/flux/dev/image-to-image"))
    fal_3d_model: str = field(default_factory=lambda: os.environ.get("FAL_3D_MODEL", "fal-ai/trellis"))
    fal_queue_base: str = field(default_factory=lambda: os.environ.get("FAL_QUEUE_BASE", "https://queue.fal.run"))

    # mock behaviour
    mock_vlm_seconds: float = field(default_factory=lambda: _f("MOCK_VLM_SECONDS", 1.2))
    mock_model_seconds: float = field(default_factory=lambda: _f("MOCK_MODEL_SECONDS", 6.0))

    # guards
    spend_cap_usd: float = field(default_factory=lambda: _f("SPEND_CAP_USD", 5.0))
    session_describe_limit: int = field(default_factory=lambda: _i("SESSION_DESCRIBE_LIMIT", 40))
    session_generate_limit: int = field(default_factory=lambda: _i("SESSION_GENERATE_LIMIT", 8))
    max_image_bytes: int = field(default_factory=lambda: _i("MAX_IMAGE_BYTES", 1_500_000))
    max_images: int = 4
    cost_vlm: float = field(default_factory=lambda: _f("COST_VLM_USD", 0.02))
    cost_image: float = field(default_factory=lambda: _f("COST_IMAGE_USD", 0.03))
    cost_model: float = field(default_factory=lambda: _f("COST_MODEL_USD", 0.10))

    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / ".data")))
    samples_dir: Path = field(default_factory=lambda: Path(os.environ.get("SAMPLES_DIR", Path(__file__).resolve().parent.parent / "samples")))
    cors_origins: list[str] = field(
        default_factory=lambda: os.environ.get(
            "CORS_ORIGINS", "https://localhost:8081,http://localhost:5190,http://localhost:5191"
        ).split(",")
    )

    @property
    def mock(self) -> bool:
        return self.vlm_provider == "mock" and self.model_provider in ("mock", "none")
