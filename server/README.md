# ClayMind game agent backend

Optional. The game (sculpting, Library, Play Kit and its built-in games) runs fully offline
without it; when it is off, the game agent's panel says so in one line.

The game agent team turns "make a game" requests into a Game Spec the client's rule engine runs:
- **Kit Analyst** (code): shape reports and role suggestions from each kit item's measured geometry.
- **Researcher** (LLM): reads Wikipedia only when the player does not know the rules or names an
  unknown game, and writes a Rule Card in its own words with sources.
- **Game Designer** (LLM): the player's rules or a Rule Card -> a built-in template plus changes,
  or a full Game Spec.
- **Referee** (code): validates the spec and checks it can be won; repairs at most twice, else the
  closest built-in game.

FastAPI + Agno AgentOS in one process; the game flow reaches the Researcher and the Designer
over A2A on the same server. Free Groq models go through a quota governor (`agents/providers.json`).

```bash
cd server
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-agents.txt   # .venv/bin/python on macOS/Linux
copy .env.example .env    # then put GROQ_API_KEY=... in .env
.venv/Scripts/python -m agents.run                                 # http://127.0.0.1:8790
.venv/Scripts/python -m pytest -q                                  # no network (fake model)
```

| Route | Purpose |
|---|---|
| `GET /v1/health` | models and their budgets |
| `POST /v1/game` | make a game: `{name?, rules?, rulesUnknown?, surprise?, kit}` -> preview + spec |
| `POST /v1/kit/analyse` | Kit Analyst reports |
| `POST /v1/kit/memory` | remember a player's Sets for suggestions |
| `GET /v1/trace` | recent agent calls (agent, model, time, cached, ok) |
| `DELETE /v1/memory` | delete this player's data |

Keys live only in `server/.env` (git-ignored). CORS is locked to the game's origins, requests are
rate-limited per IP, and the internal AgentOS / A2A routes need the shared token.
The old Phase 4 AI proxy (`server/app`) is in `_archive/server/`.
