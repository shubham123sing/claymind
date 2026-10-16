"""Claude adapter tests with a stubbed SDK client (no network, no key needed)."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.providers.anthropic_vlm import AnthropicVlm
from app.providers.base import ProviderError
from app.schemas import DescribeRequest

REQ = DescribeRequest(images=["data:image/png;base64,iVBORw0KGgo="], materials=["ceramic", "glass"], categories=["mug"])


def stub(provider: AnthropicVlm, response, calls: list):
    async def create(**kwargs):
        calls.append(kwargs)
        return response

    provider.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))


def make(text: str | None, stop_reason: str = "end_turn"):
    content = [SimpleNamespace(type="text", text=text)] if text is not None else []
    return SimpleNamespace(stop_reason=stop_reason, content=content)


@pytest.fixture()
def vlm(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    return AnthropicVlm("claude-opus-5-5", "low")


def test_valid_json_is_parsed_and_request_is_well_formed(vlm):
    calls: list = []
    body = {"name": "Mug", "category": "mug", "confidence": 0.8, "material": [{"name": "ceramic", "prob": 0.7}, {"name": "glass", "prob": 0.3}], "parts": ["body", "handle"], "notes": ""}
    stub(vlm, make(json.dumps(body)), calls)
    out = asyncio.run(vlm.describe(REQ))
    assert out.category == "mug" and out.material[0].name == "ceramic"
    kw = calls[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in kw["betas"]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["output_config"]["format"]["schema"]["properties"]["material"]["items"]["properties"]["name"]["enum"] == ["ceramic", "glass"]
    blocks = kw["messages"][0]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[-1]["type"] == "text"


def test_refusal_and_bad_output_raise_provider_error(vlm):
    stub(vlm, make(None, "refusal"), [])
    with pytest.raises(ProviderError):
        asyncio.run(vlm.describe(REQ))
    stub(vlm, make("not json"), [])
    with pytest.raises(ProviderError):
        asyncio.run(vlm.describe(REQ))
