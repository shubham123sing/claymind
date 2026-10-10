# ClayMind AI server

A small FastAPI proxy in front of AI providers. **Optional**: the game runs fully offline without it, and a static build without a server uses an in-browser mock with shipped sample models.

```bash
cd server
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows (use .venv/bin/python on macOS/Linux)
.venv/Scripts/python -m uvicorn app.main:app --port 8787
.venv/Scripts/python -m pytest -q
```

In dev, the game reaches it at `/api` (Vite proxy → `127.0.0.1:8787`). Elsewhere, pass `?aiUrl=https://your-server`.

| Route | Purpose |
|---|---|
| `GET /health` | providers, mock flag, spend vs cap |
| `POST /vlm/describe` | sculpt renders → name, category, confidence, material probabilities (strict JSON) |
| `POST /image/refine` | render + prompt → cleaner reference image (data URL) |
| `POST /model/generate` | image → async image-to-3D job (or an instant cached result) |
| `GET /model/jobs/{id}` | job status / progress / result URL |
| `GET /model/files/{key}.glb` | generated model |

- **Providers** are set by environment variables (see `.env.example`): `mock` (default), `anthropic` (Claude vision via the official SDK, strict JSON output, server-side refusal fallback enabled), `fal` (fal.ai queue API for image refine and image-to-3D; model ids are configuration, so verify them on fal.ai).
- **Guards**: image type/size limits, per-session quotas (`X-Session` header), a monthly global spend cap persisted in `.data/spend.json`. Mock calls cost nothing.
- **Cache**: every result is stored by content hash in `.data/cache`, so the same request is never paid for twice.
- **Keys** live only in this server's environment and never reach the browser.
- Sample models for the mock image-to-3D provider are in `samples/` (regenerate with `npx vite-node scripts/make-samples.ts` in `client/`).
