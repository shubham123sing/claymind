"""Claude vision provider: "what is this sculpt and what is it probably made of?"

Uses the official Anthropic Python SDK. The answer is constrained to strict JSON
with a schema (structured outputs), materials limited to the game's material ids.
Server-side refusal fallbacks are enabled (fallbacks="default"); a refusal or any
API error raises ProviderError so the game falls back to its local estimate.
The key comes from the environment (ANTHROPIC_API_KEY or an `ant auth login`
profile) and never reaches the browser.
"""
from __future__ import annotations

import json

import anthropic

from ..schemas import DescribeRequest, DescribeResult
from .base import ProviderError

PROMPT = """These are renders of a small clay sculpt that a player shaped by hand in a mixed-reality game \
(plain clay shading, several viewing angles). Identify what real-world object the player most likely \
intended to make, and what that real object would most plausibly be made of.

Rules:
- Judge the intended object, not the clay itself. Hand-made shapes are rough; be generous.
- `category`: one of the known categories if one fits, otherwise a short lowercase noun.
- `material`: up to 4 entries, `name` must be one of the allowed material ids, probabilities sum to 1.
- `confidence`: how sure you are about the category (0-1). Use low values when unsure.
- `name`: a short display name (1-3 words), e.g. "Mug", "Coffee mug", "Toy car".

Known categories: {categories}
Allowed material ids: {materials}
Local shape analysis (may be wrong): best template match "{best}" ({sim:.0%}), size {size} cm."""


def _schema(materials: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "category": {"type": "string"},
            "confidence": {"type": "number"},
            "material": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"name": {"type": "string", "enum": materials}, "prob": {"type": "number"}},
                    "required": ["name", "prob"],
                    "additionalProperties": False,
                },
            },
            "parts": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
        },
        "required": ["name", "category", "confidence", "material", "parts", "notes"],
        "additionalProperties": False,
    }


class AnthropicVlm:
    name = "anthropic"

    def __init__(self, model: str, effort: str):
        self.model = model
        self.effort = effort
        self.version = f"{model}:{effort}:1"
        self.client = anthropic.AsyncAnthropic(timeout=60.0, max_retries=2)

    async def describe(self, req: DescribeRequest) -> DescribeResult:
        content: list[dict] = []
        for url in req.images:
            mime, b64 = url[5:].split(";base64,", 1)
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
        h = req.hints
        content.append({
            "type": "text",
            "text": PROMPT.format(
                categories=", ".join(req.categories) or "(none)",
                materials=", ".join(req.materials),
                best=h.best_template or "none",
                sim=h.best_similarity,
                size=" x ".join(f"{v:.0f}" for v in h.size_cm) or "?",
            ),
        })
        try:
            response = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=4096,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": _schema(req.materials)}},
                messages=[{"role": "user", "content": content}],
            )
        except anthropic.RateLimitError as e:
            raise ProviderError("vlm rate limited") from e
        except anthropic.APIStatusError as e:
            raise ProviderError(f"vlm error {e.status_code}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("vlm unreachable") from e
        if response.stop_reason == "refusal":
            raise ProviderError("vlm declined")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            raise ProviderError("vlm returned no text")
        try:
            return DescribeResult.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValueError) as e:
            raise ProviderError("vlm returned invalid JSON") from e
