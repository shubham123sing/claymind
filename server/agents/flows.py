"""How the agents work together. The Helper's decisions drive these flows; the Helper reaches
the Researcher, Designer and Coach through A2A on this server (A2A_MODE=local) or by direct
calls (A2A_MODE=inproc). Kit Analyst and Referee are code.

Web priority for a game (never search just because it is possible):
  1. the player's own rules (no web) -> 2. a built-in template or a cached Rule Card ->
  3. the Researcher (Wikipedia) only when the player does not know the rules, or names an
     unknown game without giving rules. Partial rules are kept; the web only fills the gaps.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from .analyst import analyse
from .governed_model import STATE
from .knowledge import KitGraph, Memory, PassageIndex
from .referee import TEMPLATES, VOCAB, apply_adapt, closest_template, describe, referee, template
from .schemas import CheckIn, CheckOut, CoachGuide, DesignOut, HelperOut, KitDescriptor, RuleCard, Source
from .store import Cache, Trace, current_agent, input_hash
from .web import GUARD_THRESHOLD, injection_score, search_pages

BLOCKED = re.compile(r"\b(kill|murder|gun|weapon|bomb|suicide|sex|nude|porn|drug|terror)\w*\b", re.I)
MAX_REPAIRS = 2


def fit_to_schema(schema: type[BaseModel], data: Any) -> Any:
    """Trim over-long text and lists to the schema's limits (a model that wrote too much
    still gave a usable answer); nested models are trimmed too. Anything else is unchanged."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    for name, f in schema.model_fields.items():
        if name not in out:
            continue
        v = out[name]
        limit = next((m.max_length for m in f.metadata if hasattr(m, "max_length")), None)
        inner = getattr(f.annotation, "__args__", (None,))[0] if isinstance(v, list) else f.annotation
        if isinstance(v, list) and isinstance(inner, type) and issubclass(inner, BaseModel):
            v = [fit_to_schema(inner, x) for x in v]
        elif isinstance(v, dict) and isinstance(inner, type) and issubclass(inner, BaseModel):
            v = fit_to_schema(inner, v)
        if limit is not None and isinstance(v, (str, list)) and len(v) > limit:
            v = (v[: limit - 1].rstrip() + "…") if isinstance(v, str) else v[:limit]
        out[name] = v
    return out


class AgentDown(Exception):
    """The model chain or an agent failed: callers degrade to a built-in answer."""


class Orchestrator:
    def __init__(self, settings, team: dict, cache: Cache, trace: Trace, passages: PassageIndex, memory: Memory):
        self.research_busy = False
        self.s, self.team, self.cache, self.trace, self.passages, self.memory = settings, team, cache, trace, passages, memory
        self.http = httpx.AsyncClient()

    # ---------- calling an agent ----------

    async def call(self, agent_id: str, payload: dict, schema: type[BaseModel], use_cache: bool = True) -> BaseModel:
        key = input_hash(agent_id, payload)
        if use_cache and (hit := self.cache.get(key)) is not None:
            self.trace.add(agent=agent_id, model="cache", ms=0, cached=True, ok=True)
            return schema.model_validate(hit)
        text = "INPUT JSON:\n" + json.dumps(payload, ensure_ascii=False)
        token = current_agent.set(agent_id)
        try:
            raw = await (self._a2a(agent_id, text) if self.s.a2a_mode == "local" else self._inproc(agent_id, text))
        finally:
            current_agent.reset(token)
        try:
            data = raw if isinstance(raw, dict) else json.loads(raw)
            try:
                out = schema.model_validate(data)
            except ValidationError:
                out = schema.model_validate(fit_to_schema(schema, data))
        except (ValidationError, ValueError, TypeError) as e:
            self.trace.add(agent=agent_id, model="schema", ms=0, cached=False, ok=False, error=f"wrong shape: {str(e)[:160]}")
            raise AgentDown(f"{agent_id} answered in the wrong shape") from e
        if use_cache:
            self.cache.put(key, agent_id, out.model_dump())
        return out

    async def _inproc(self, agent_id: str, text: str) -> Any:
        try:
            run = await self.team[agent_id].arun(text)
        except Exception as e:
            raise AgentDown(str(e)) from e
        c = run.content
        if isinstance(c, BaseModel):
            return c.model_dump()
        if run.status and str(run.status).lower().endswith("error"):
            raise AgentDown(str(c))
        return c

    async def _a2a(self, agent_id: str, text: str) -> Any:
        body = {
            "jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "message/send",
            "params": {"message": {"messageId": str(uuid.uuid4()), "role": "user", "parts": [{"kind": "text", "text": text}]}},
        }
        try:
            r = await self.http.post(
                f"http://127.0.0.1:{self.s.port}/a2a/agents/{agent_id}/v1/message:send",
                json=body, headers={"X-A2A-Token": self.s.a2a_token}, timeout=self.s.timeout_s * 3 + 5,
            )
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise AgentDown(f"A2A call to {agent_id} failed: {e}") from e
        result = r.json().get("result", {})
        state = (result.get("status") or {}).get("state")
        texts = [p.get("text", "") for m in result.get("history", []) if m.get("role") == "agent" for p in m.get("parts", []) if p.get("kind") == "text"]
        texts += [p.get("text", "") for a in result.get("artifacts", []) or [] for p in a.get("parts", []) if p.get("kind") == "text"]
        if state == "failed" or not texts:
            raise AgentDown(f"{agent_id} failed: {texts[-1] if texts else state}")
        return texts[-1]

    # ---------- Helper ----------

    async def helper(self, message: str, context: dict, kit: list[KitDescriptor], user: str) -> dict:
        if BLOCKED.search(message):
            return {"intent": "blocked", "reply": "That doesn't fit here. Ask me about building or playing with your clay."}
        try:
            h: HelperOut = await self.call("helper", {"message": message[:600], "context": context}, HelperOut, use_cache=False)  # type: ignore[assignment]
        except AgentDown:
            return {"intent": "offline", "reply": "AI helper is offline, built-in games still work."}
        out: dict = {"intent": h.intent, "reply": h.reply, "fix": h.fix if h.intent == "stuck" else "none"}
        if h.intent == "teach" and h.object_name:
            out["guide"] = await self.coach_guide(h.object_name)
        elif h.intent == "kit_ideas":
            kg = KitGraph(kit, self.cache.by_kind("rulecard"), self.memory.get(user).get("sets", []))
            out["games"] = kg.local_games()[:5]
            out["summary"] = kg.global_summary()
        elif h.intent == "make_game":
            out["game"] = await self.make_game(h.game_name, h.user_rules, h.rules_unknown, h.surprise, kit, user)
        return out

    # ---------- games ----------

    async def make_game(self, name: str | None, user_rules: str | None, rules_unknown: bool, surprise: bool, kit: list[KitDescriptor], user: str) -> dict:
        reports = [analyse(k).model_dump() for k in kit]
        kg = KitGraph(kit, self.cache.by_kind("rulecard"), [])
        name = (name or "").strip()[:60]
        if surprise or not (name or user_rules):
            best = kg.local_games()[0]
            return self._template_answer(template(best["id"]), "surprise", "Surprise: the game that uses most of your toys")
        known = self._template_named(name) if name else None
        if known and not user_rules and not rules_unknown:
            return self._template_answer(known, "template", "Using the built-in rules")
        card: RuleCard | None = None
        path, note, sources = "your_rules", "Using your rules", []
        if not user_rules or rules_unknown:
            cached = [c for c in self.cache.by_kind("rulecard") if c["game"].lower() == name.lower()]
            if cached:
                card, path, note = RuleCard.model_validate(cached[0]), "cached", "Using rules looked up before"
            elif self.s.web and name:
                path, note = "web", "Looking up the rules"
                self.research_busy = False
                card = await self.research(name, user_rules)
            if card is None and not user_rules:
                fb = closest_template(name)
                why = "The free AI models are busy right now (try again in a minute)" if self.research_busy else f"I couldn't find the rules for {name}"
                ans = self._template_answer(fb, "fallback", f"{why}: the closest built-in game is {fb['name']}")
                return ans
        if card:
            sources = [s.model_dump() for s in card.sources]
        design_in = {
            "game": name, "player_rules": user_rules, "rule_card": card.model_dump() if card else None, "kit": reports,
            "vocabulary": VOCAB,
            "example_template": TEMPLATES[1], "template_ids": [{"id": t["id"], "name": t["name"], "summary": t["summary"]} for t in TEMPLATES],
            "passages": [p["text"][:600] for p in self.passages.search(f"{name} rules {user_rules or ''}", 3)],
        }
        errors: list[str] = []
        for attempt in range(MAX_REPAIRS + 1):
            try:
                d: DesignOut = await self.call("designer", {**design_in, "REFEREE_ERRORS": errors}, DesignOut)  # type: ignore[assignment]
            except AgentDown:
                break
            base = template(d.template_id) if d.template_id else None
            adapt_cannot: list[str] = []
            if base and d.adapt and not d.spec:
                spec, adapt_cannot = apply_adapt(base, d.adapt.model_dump(exclude_none=True))
                from_template = False
            else:
                from_template = bool(base and not d.spec)
                spec = base if from_template else d.spec
            if spec is None:
                errors = ["give a template_id from template_ids or a full spec"]
                continue
            if from_template and user_rules and attempt < MAX_REPAIRS and not d.cannot:
                # the player's rules usually change counts, players, turns or how to win: a plain template ignores them
                errors = [f"the player's own rules must be applied: keep template_id {spec['id']} and give adapt (players, shotsPerTurn, maxTurns, timerSec, counts, target), or list each rule you cannot express in cannot"]
                continue
            errors = referee(spec)
            if not errors:
                cannot = list(d.cannot) + adapt_cannot
                if from_template and user_rules and not d.cannot:
                    cannot.append(f"Your rules were not applied: this plays the built-in {spec['name']} rules")
                return {
                    "path": path, "note": note, "templateId": d.template_id if from_template else None,
                    "spec": None if from_template else spec,
                    # a template's own lines: the preview must describe the game that will really run
                    "preview": {"name": spec["name"], "howToPlay": spec["howToPlay"][:4] if from_template else describe(spec), "missing": d.missing},
                    "cannot": cannot, "adjustments": d.adjustments, "sources": sources, "guessed": bool(card and card.guessed), "repairs": attempt,
                }
            self.trace.add(agent="referee", model="code", ms=0, cached=False, ok=False, error="; ".join(errors[:3]))
        fb = closest_template(f"{name} {user_rules or ''}")
        ans = self._template_answer(fb, "fallback", f"I couldn't make a safe game from that, so here is {fb['name']}")
        ans["sources"] = sources
        return ans

    def _template_named(self, name: str) -> dict | None:
        n = name.lower()
        for t in TEMPLATES:
            if t["id"] in n.replace(" ", "-") or t["name"].lower() in n:
                return t
        return None

    @staticmethod
    def _template_answer(t: dict, path: str, note: str) -> dict:
        return {"path": path, "note": note, "templateId": t["id"], "spec": None, "preview": {"name": t["name"], "howToPlay": t["howToPlay"][:4], "missing": []}, "cannot": [], "adjustments": [], "sources": [], "guessed": False}

    async def research(self, game: str, partial_rules: str | None) -> RuleCard | None:
        t0 = time.monotonic()
        try:
            pages = await search_pages(f"{game} game rules", self.http, exact=game)
        except httpx.HTTPError:
            self.trace.add(agent="researcher", model="wikipedia", ms=round((time.monotonic() - t0) * 1000), cached=False, ok=False, error="search failed")
            return None
        safe = []
        for p in pages:
            score = await injection_score(p["text"], self.http, self.s.key(self.s.guard.get("keyEnv", "GROQ_API_KEY")), self.s.guard.get("model")) if not self.s.fake_llm else 0.0
            if score < GUARD_THRESHOLD:
                safe.append(p)
            else:
                self.trace.add(agent="researcher", model="guard", ms=0, cached=False, ok=False, error=f"dropped {p['title']} ({score:.2f})")
        self.trace.add(agent="researcher", model="wikipedia", ms=round((time.monotonic() - t0) * 1000), cached=False, ok=bool(safe), pages=len(safe))
        if not safe:
            return None
        try:
            card: RuleCard = await self.call("researcher", {"game": game, "player_partial_rules": partial_rules, "pages": safe}, RuleCard)  # type: ignore[assignment]
        except AgentDown as e:
            self.research_busy = "busy" in str(e)
            return None
        # sources: only pages that were really read
        urls = {p["url"]: p["title"] for p in safe}
        card.sources = [s for s in card.sources if s.url in urls] or [Source(title=t, url=u) for u, t in urls.items()]
        self.cache.put(input_hash("rulecard", game.lower()), "rulecard", card.model_dump())
        for p in safe:
            self.passages.add(p["url"], p["title"], p["text"])
        return card

    # ---------- coach ----------

    async def coach_guide(self, goal: str) -> dict:
        try:
            g: CoachGuide = await self.call("coach", {"build": goal[:80]}, CoachGuide)  # type: ignore[assignment]
            return g.model_dump()
        except AgentDown:
            return {"title": goal, "steps": [], "offline": True}

    @staticmethod
    def coach_check(c: CheckIn) -> CheckOut:
        """Code, no AI: the creation against the step's measurements, one specific fix."""
        st = c.step
        if st.material and st.material not in c.materials:
            return CheckOut(ok=False, message=f"This step wants {st.material}.", fix=f"Touch the piece, then Material -> {st.material}")
        if st.size_cm:
            names = ["wide", "tall", "deep"]
            for i, (want, have) in enumerate(zip(st.size_cm, c.sizeCm)):
                if want > 0 and abs(have - want) / want > 0.25:
                    d = want - have
                    verb = "add" if d > 0 else "take off"
                    return CheckOut(ok=False, message=f"It is {have:.1f} cm {names[i]}, the step wants about {want:.1f} cm.", fix=f"{verb} about {abs(d):.1f} cm")
        return CheckOut(ok=True, message="Looks good!")

    def models(self) -> dict:
        return STATE["governor"].snapshot() if STATE["governor"] else {}
