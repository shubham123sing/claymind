"""Settings from the environment (and server/.env). Keys never leave the server."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

PKG = Path(__file__).resolve().parent
SERVER = PKG.parent


def load_env_file(path: Path = SERVER / ".env") -> None:
    """KEY=VALUE lines into os.environ (existing variables win)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


DEFAULT_ORIGINS = "http://localhost:5190,http://localhost:5191,https://localhost:8081,https://shubham123sing.github.io"


@dataclass
class Settings:
    port: int = 8790
    #: the game flow -> Researcher / Designer: "local" = A2A over HTTP on this server, "inproc" = direct calls
    a2a_mode: str = "local"
    #: shared token for the /a2a routes (random per start unless A2A_TOKEN is set)
    a2a_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    allowed_origins: list[str] = field(default_factory=list)
    rate_per_min: int = 30
    timeout_s: float = 12.0
    data_dir: Path = SERVER / ".data" / "agents"
    #: tests: answer from canned JSON instead of calling a model
    fake_llm: bool = False
    #: the web (Wikipedia) may be used at all
    web: bool = True
    chain: list[dict] = field(default_factory=list)
    guard: dict = field(default_factory=dict)
    #: the local embedding model for "something similar" (off: word matching only, less memory)
    embeddings: bool = True
    models_dir: Path = SERVER / ".data" / "models"

    def key(self, env_name: str) -> str | None:
        return os.environ.get(env_name) or None


def load_settings() -> Settings:
    load_env_file()
    providers = json.loads((PKG / "providers.json").read_text(encoding="utf-8"))
    s = Settings(
        # a host's own PORT (Render, Koyeb, ...) when CLAYMIND_AGENTS_PORT is not set
        port=int(os.environ.get("CLAYMIND_AGENTS_PORT") or os.environ.get("PORT") or "8790"),
        a2a_mode=os.environ.get("A2A_MODE", "local"),
        allowed_origins=[o.strip() for o in os.environ.get("CLAYMIND_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
        rate_per_min=int(os.environ.get("CLAYMIND_RATE_PER_MIN", "30")),
        timeout_s=float(os.environ.get("CLAYMIND_LLM_TIMEOUT_S", "12")),
        fake_llm=os.environ.get("CLAYMIND_FAKE_LLM") == "1",
        web=os.environ.get("CLAYMIND_WEB", "1") == "1",
        embeddings=os.environ.get("CLAYMIND_EMBEDDINGS", "1") == "1",
        chain=providers["chain"],
        guard=providers.get("guard", {}),
    )
    if os.environ.get("A2A_TOKEN"):
        s.a2a_token = os.environ["A2A_TOKEN"]
    if os.environ.get("CLAYMIND_DATA_DIR"):
        s.data_dir = Path(os.environ["CLAYMIND_DATA_DIR"])
    if os.environ.get("CLAYMIND_MODELS_DIR"):
        s.models_dir = Path(os.environ["CLAYMIND_MODELS_DIR"])
    if s.a2a_mode not in ("local", "inproc"):
        raise ValueError("A2A_MODE must be local or inproc")
    s.data_dir.mkdir(parents=True, exist_ok=True)
    # Agno usage telemetry off: nothing about the player or the game goes to Agno
    os.environ["AGNO_TELEMETRY"] = "false"
    return s
