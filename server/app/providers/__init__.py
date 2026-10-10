"""Provider registry: pick implementations from Settings (env vars)."""
from __future__ import annotations

from ..config import Settings
from .base import ImageProvider, ModelProvider, ProviderError, VlmProvider
from .mock import MockImage, MockModel, MockVlm


def make_vlm(s: Settings) -> VlmProvider | None:
    if s.vlm_provider == "mock":
        return MockVlm(s.mock_vlm_seconds)
    if s.vlm_provider == "anthropic":
        from .anthropic_vlm import AnthropicVlm

        return AnthropicVlm(s.anthropic_model, s.anthropic_effort)
    return None


def make_image(s: Settings) -> ImageProvider | None:
    if s.image_provider == "mock":
        return MockImage()
    if s.image_provider == "fal":
        from .fal import FalImage

        return FalImage(s.fal_key, s.fal_image_model, s.fal_queue_base)
    return None


def make_model(s: Settings) -> ModelProvider | None:
    if s.model_provider == "mock":
        return MockModel(s.mock_model_seconds, s.samples_dir)
    if s.model_provider == "fal":
        from .fal import FalModel

        return FalModel(s.fal_key, s.fal_3d_model, s.fal_queue_base)
    return None


__all__ = ["make_vlm", "make_image", "make_model", "ProviderError"]
