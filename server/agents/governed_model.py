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
        for p in s.chain:
            if not gov.try_acquire(p["id"], est):
                continue
            # a fresh client per attempt: no shared mutable model id between concurrent calls
            model = Groq(id=p["model"], api_key=s.key(p["keyEnv"]), timeout=int(s.timeout_s), max_retries=0)
            try:
                resp = await asyncio.wait_for(
                    model.ainvoke(messages, assistant_message, response_format=response_format, tools=tools, tool_choice=tool_choice, run_response=run_response, compress_tool_results=compress_tool_results),
                    timeout=s.timeout_s,
                )
            except ModelProviderError as e:
                last = e
                if e.status_code in RETRY_STATUS or e.status_code is None:
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
        raise ModelProviderError(message=f"All free models are busy right now ({last or 'no budget left'})", status_code=503, model_name=self.name, model_id=self.id)

    def invoke(self, *args, **kwargs) -> ModelResponse:  # sync path: same chain
        return asyncio.run(self.ainvoke(*args, **kwargs))
