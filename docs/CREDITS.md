# Credits

## Optional backend: game agent and multiplayer rooms
- **Groq** free tier, models `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` (in that order, through the quota governor; `qwen/qwen3.8-27b` also for the optional vision check, which sends pictures the game renders of a toy, checked 2026-10-16) and `meta-llama/llama-prompt-guard-2-86m` (screens fetched web text). Prompts are sent to Groq: never personal data. Checked available on 2026-10-15.
- **ClayMind Rule Cards** (`server/agents/data/rule-cards.json`): about 30 common table games written for ClayMind in its own words, used before any web search.
- **Wikipedia** (MediaWiki API, no key) is the one web search source (the page with the game's own name first, then search hits). Rule Cards summarise it in their own words with links to the pages; Wikipedia text is CC BY-SA 4.0.
- **BAAI/bge-small-en-v1.5** (MIT) through **fastembed** (Apache-2.0): local embeddings for the passage index, downloaded once (about 65 MB) from Hugging Face.
- **Agno** 3.1.3 (Apache-2.0, AgentOS and A2A), **a2a-sdk**, **FastAPI** (also the multiplayer WebSocket relay), **Uvicorn** with **websockets** (BSD-3-Clause), **httpx** (BSD-3-Clause), **Pydantic**. Agno usage telemetry is switched off.

## The game
- Multiplayer avatars (head and hands) are original low-poly shapes made in code; snapshots are compressed with the browser's built-in CompressionStream.
- three.js / IWSDK (Meta, MIT), Havok physics through IWSDK, Khronos glTF validator (tests only).
- Everything in a GLB or kit download is the player's own creation; no third-party asset is included.
- **Sounds** are all procedural (Web Audio oscillators and filtered noise made in code, no audio files): the clay squish while pulling, material impact sounds, and the UI sounds (grab pop, let-go, score ding, join chime, fanfare). Nothing to license.
- **Hand models:** `client/public/input-profiles/generic-hand` (left.glb, right.glb) from `@webxr-input-profiles/assets` 1.0.20, MIT (licence file alongside).
- **The VR room** (walls, window view, shelf, rug) is drawn in code; no textures or image files.
