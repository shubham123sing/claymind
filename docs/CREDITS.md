# Credits

## Optional backend: game agent and multiplayer rooms
- **Groq** free tier, models `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` (in that order, through the quota governor) and `meta-llama/llama-prompt-guard-2-86m` (screens fetched web text). Prompts are sent to Groq: never personal data. Checked available on 2026-10-15.
- **Wikipedia** (MediaWiki API, no key) is the one web search source (the page with the game's own name first, then search hits). Rule Cards summarise it in their own words with links to the pages; Wikipedia text is CC BY-SA 4.0.
- **BAAI/bge-small-en-v1.5** (MIT) through **fastembed** (Apache-2.0): local embeddings for the passage index, downloaded once (about 65 MB) from Hugging Face.
- **Agno** 3.1.3 (Apache-2.0, AgentOS and A2A), **a2a-sdk**, **FastAPI** (also the multiplayer WebSocket relay), **Uvicorn** with **websockets** (BSD-3-Clause), **httpx** (BSD-3-Clause), **Pydantic**. Agno usage telemetry is switched off.

## The game
- Multiplayer avatars (head and hands) are original low-poly shapes made in code; snapshots are compressed with the browser's built-in CompressionStream.
- three.js / IWSDK (Meta, MIT), Havok physics through IWSDK, Khronos glTF validator (tests only).
- Everything in a GLB or kit download is the player's own creation; no third-party asset is included.
