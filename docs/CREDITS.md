# Credits

## Optional agent backend (Update 2)
- **Groq** free tier, models `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` (in that order, through the quota governor) and `meta-llama/llama-prompt-guard-2-86m` (screens fetched web text). Prompts are sent to Groq: never personal data. Checked available on 2026-10-15.
- **Wikipedia** (MediaWiki API, no key) is the one web search source. Rule Cards summarise it in their own words with links to the pages; Wikipedia text is CC BY-SA 4.0.
- **BAAI/bge-small-en-v1.5** (MIT) through **fastembed** (Apache-2.0): local embeddings for the passage index, downloaded once (about 65 MB) from Hugging Face.
- **Agno** 3.1.3 (Apache-2.0, AgentOS and A2A), **a2a-sdk**, **FastAPI**, **Uvicorn**, **httpx** (BSD-3-Clause), **Pydantic**. Agno usage telemetry is switched off.

## The game
- three.js / IWSDK (Meta, MIT), Havok physics through IWSDK, Khronos glTF validator (tests only).
- Everything in a GLB or kit download is the player's own creation; no third-party asset is included.
