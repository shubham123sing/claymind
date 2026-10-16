"""ClayMind agent backend: FastAPI + Agno AgentOS in one process.

Public (the game): /v1/* only, CORS locked to the app origins, rate-limited per IP.
Internal: AgentOS routes and the A2A routes (/a2a/agents/{id}/v1/message:send) need the
shared token (header X-A2A-Token); the game flow uses them to reach the Researcher and the Designer.

Run (dev):  cd server && .venv/Scripts/python -m agents.run
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from agno.os import AgentOS
from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .analyst import analyse
from .config import Settings, load_settings
from .flows import Orchestrator
from .governed_model import install
from .governor import Governor
from .knowledge import Memory, PassageIndex
from .rooms import RoomHub
from .schemas import KitDescriptor
from .store import Cache, Trace
from .team import build_team
from .vision import look, views_ok



class GameIn(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    rules: str | None = Field(default=None, max_length=600)
    rulesUnknown: bool = False
    surprise: bool = False
    kit: list[KitDescriptor] = Field(default_factory=list, max_length=50)
    #: the client's physics dry run of the last answer failed: the Designer must fix these
    checkProblems: list[str] = Field(default_factory=list, max_length=4)


class IntentIn(BaseModel):
    #: the typed words, each pointing word replaced by its tags: "flick [A] at [B C]"
    text: str = Field(min_length=1, max_length=300)
    #: tag -> what the item is called ("your Red ball", "a built-in block")
    items: dict[str, str] = Field(max_length=12)
    zones: int = Field(default=0, ge=0, le=8)
    paths: int = Field(default=0, ge=0, le=4)


class VisionIn(BaseModel):
    """Pictures the game rendered of one toy (never a camera image), with what it measured."""
    name: str = Field(max_length=40)
    sizeCm: list[float] = Field(min_length=3, max_length=3)
    massKg: float = Field(ge=0, le=100)
    views: list[str] = Field(min_length=1, max_length=2)


class KitIn(BaseModel):
    kit: list[KitDescriptor] = Field(default_factory=list, max_length=50)
    sets: list[dict] = Field(default_factory=list, max_length=50)


class _QuietAgno(logging.Filter):
    # parse_response=False (raw JSON for A2A) makes Agno log a misleading warning on every run
    def filter(self, record: logging.LogRecord) -> bool:
        return "Run response content is not a string" not in record.getMessage()


logging.getLogger("agno").addFilter(_QuietAgno())


def player(x_player_id: str | None) -> str:
    """A random id the client keeps in localStorage (no account, nothing personal)."""
    return (x_player_id or "local")[:40]


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or load_settings()
    governor, trace = Governor(s.chain), Trace()
    install(governor, trace, s)
    cache = Cache(s.data_dir / "cache.sqlite")
    passages = PassageIndex(s.data_dir / "passages.sqlite", s.models_dir, use_model=s.embeddings and not s.fake_llm)
    memory = Memory(s.data_dir / "memory")
    team = build_team()
    orch = Orchestrator(s, team, cache, trace, passages, memory)

    base = FastAPI(title="ClayMind agents", version="1")
    hits: dict[str, deque] = defaultdict(deque)

    @base.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if path.startswith("/v1/"):
            # rate limit per IP (sliding minute)
            ip = request.client.host if request.client else "?"
            now, q = time.monotonic(), hits[ip]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= s.rate_per_min:
                return JSONResponse({"error": "Too many requests, wait a moment"}, status_code=429)
            q.append(now)
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        # everything else (AgentOS, A2A) is internal
        if request.headers.get("x-a2a-token") != s.a2a_token:
            return JSONResponse({"error": "not found"}, status_code=404)
        return await call_next(request)

    @base.get("/v1/health")
    async def health():
        return {"ok": True, "a2aMode": s.a2a_mode, "web": s.web, "models": orch.models(), "fake": s.fake_llm}

    @base.post("/v1/game")
    async def game(body: GameIn, x_player_id: str | None = Header(default=None)):
        out = await orch.make_game(body.name, body.rules, body.rulesUnknown, body.surprise, body.kit, player(x_player_id), [p[:160] for p in body.checkProblems])
        if body.rules:
            memory.update(player(x_player_id), rulesChanged=[{"game": body.name, "rules": body.rules[:200]}])
        return out

    @base.post("/v1/intent")
    async def intent(body: IntentIn):
        items = {k[:4]: v[:60] for k, v in body.items.items()}
        return await orch.resolve_intent(body.text, items, body.zones, body.paths)

    @base.post("/v1/vision")
    async def vision(body: VisionIn):
        if not views_ok(body.views):
            return JSONResponse({"error": "pictures must be 1-2 small PNG / JPEG / WebP data URLs"}, status_code=422)
        return await look(s, governor, trace, cache, orch.http, body.views, body.name, body.sizeCm, body.massKg)

    @base.post("/v1/kit/analyse")
    async def kit_analyse(body: KitIn):
        return {"items": [analyse(k).model_dump() for k in body.kit]}

    @base.post("/v1/kit/memory")
    async def kit_memory(body: KitIn, x_player_id: str | None = Header(default=None)):
        memory.update(player(x_player_id), kit=[k.model_dump() for k in body.kit], sets=body.sets)
        return {"ok": True}

    @base.get("/v1/trace")
    async def get_trace():
        return {"calls": trace.list()}

    @base.delete("/v1/memory")
    async def delete_memory(x_player_id: str | None = Header(default=None)):
        return {"deleted": memory.delete(player(x_player_id))}

    # multiplayer rooms (Update 3, Step C): a WebSocket relay, memory only
    hub = RoomHub(s.allowed_origins)
    base.add_api_websocket_route("/v1/rooms", hub.handle)

    @base.get("/v1/rooms/health")
    async def rooms_health():
        return {"ok": True, "rooms": len(hub.rooms), "players": sum(len(r.players) for r in hub.rooms.values())}

    agent_os = AgentOS(
        id="claymind", name="ClayMind agents", agents=list(team.values()), a2a_interface=True,
        base_app=base, telemetry=False, on_route_conflict="preserve_base_app",
    )
    app = agent_os.get_app()
    # CORS last = outermost: only the game's own pages may call /v1
    app.add_middleware(CORSMiddleware, allow_origins=s.allowed_origins, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Player-ID"])
    app.state.settings, app.state.orch, app.state.trace, app.state.rooms = s, orch, trace, hub
    return app
