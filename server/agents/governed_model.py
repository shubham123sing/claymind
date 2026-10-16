"""A Groq model for Agno agents that asks the quota governor which free model to use for
each call and falls through the chain on 429 / 5xx / timeouts. Shared state (governor,
trace, test answers) lives in this module, not on the model object: AgentOS copies agents
per A2A request, and every copy must use the same budget.

Test mode (CLAYMIND_FAKE_LLM=1): answers come from `FAKE_ANSWERS[agent label]`, a function
of the prompt text, and no network call is made.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable

from agno.exceptions import ModelProviderError
from agno.models.groq import Groq
from agno.models.response import ModelResponse

from .governor import Governor
from .store import Trace, current_agent

STATE: dict[str, Any] = {"governor": None, "trace": None, "settings": None}
FAKE_ANSWERS: dict[str, Callable[[str], str]] = {}

RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
#: wait at most this long for a busy free model (the game gives up after 30 s)
MAX_WAIT_S = 12.0


def install(governor: Governor, trace: Trace, settings: Any) -> None:
    STATE.update(governor=governor, trace=trace, settings=settings)


def _prompt_text(messages: list) -> str:
    return "\n".join(str(getattr(m, "content", "") or "") for m in messages)


@dataclass
class GovernedGroq(Groq):
    id: str = "claymind-governed"
    name: str = "GovernedGroq"
    #: which agent this model serves (trace, test answers); copied with the agent
    label: str = ""

    async def ainvoke(self, messages, assistant_message, response_format=None, tools=None, tool_choice=None, run_response=None, compress_tool_results=False) -> ModelResponse:
        s, gov, trace = STATE["settings"], STATE["governor"], STATE["trace"]
        label = self.label or current_agent.get()
        text = _prompt_text(messages)
        t0 = time.monotonic()
        if s is not None and s.fake_llm:
            answer = FAKE_ANSWERS.get(label, lambda _t: "{}")(text)
            trace.add(agent=label, model="fake", tokensIn=len(text) // 4, tokensOut=len(answer) // 4, ms=0, cached=False, ok=True)
            return ModelResponse(role="assistant", content=answer)
        est = len(text) // 4 + 800
        last: Exception | None = None
        for attempt in range(2):
            if attempt:
                # every free model was busy this minute: wait for the first one to free up (once, briefly)
                wait = min(gov.wait_hint(p["id"], est) for p in s.chain)
                if wait > MAX_WAIT_S:
                    break
                trace.add(agent=label, model="governor", ms=round(wait * 1000), cached=False, ok=True, error=f"waited {wait:.1f} s for a free model")
                await asyncio.sleep(wait + 0.2)
            resp = await self._try_chain(messages, assistant_message, response_format, tools, tool_choice, run_response, compress_tool_results, label, est, t0)
            if isinstance(resp, ModelResponse):
                return resp
            last = resp or last
        if last is None:
            trace.add(agent=label, model="governor", ms=0, cached=False, ok=False, error="busy: no free-tier budget left this minute")
        raise ModelProviderError(message=f"All free models are busy right now ({last or 'no budget left'})", status_code=503, model_name=self.name, model_id=self.id)

    async def _try_chain(self, messages, assistant_message, response_format, tools, tool_choice, run_response, compress_tool_results, label, est, t0):
        """One pass down the chain: the response, or the last error (None: no budget anywhere)."""
        s, gov, trace = STATE["settings"], STATE["governor"], STATE["trace"]
        last: Exception | None = None
        for p in s.chain:
            if not gov.try_acquire(p["id"], est):
                continue
            # a fresh client per attempt: no shared mutable model id between concurrent calls
            model = Groq(id=p["model"], api_key=s.key(p["keyEnv"]), timeout=int(s.timeout_s), max_retries=0, max_tokens=p.get("maxTokens"))
            try:
                resp = await asyncio.wait_for(
                    model.ainvoke(messages, assistant_message, response_format=response_format, tools=tools, tool_choice=tool_choice, run_response=run_response, compress_tool_results=compress_tool_results),
                    timeout=s.timeout_s,
                )
            except ModelProviderError as e:
                last = e
                # a model that could not produce valid JSON this time: the next one may
                bad_json = e.status_code == 400 and "json_validate_failed" in str(e)
                if e.status_code in RETRY_STATUS or e.status_code is None or bad_json:
                    gov.fail(p["id"])
                    trace.add(agent=label, model=p["model"], ms=round((time.monotonic() - t0) * 1000), cached=False, ok=False, error=f"{e.status_code}")
                    continue
                raise
            except asyncio.TimeoutError as e:
                last = e
                gov.fail(p["id"])
                trace.add(agent=label, model=p["model"], ms=round((time.monotonic() - t0) * 1000), cached=False, ok=False, error="timeout")
                continue
            usage = resp.response_usage
            tin, tout = (usage.input_tokens, usage.output_tokens) if usage else (est, 0)
            gov.settle(p["id"], est, tin + tout)
            trace.add(agent=label, model=p["model"], tokensIn=tin, tokensOut=tout, ms=round((time.monotonic() - t0) * 1000), cached=False, ok=True)
            return resp
        return last

    def invoke(self, *args, **kwargs) -> ModelResponse:  # sync path: same chain
        return asyncio.run(self.ainvoke(*args, **kwargs))
