# Decisions (one line each: what, why)

- **XR runtime:** IWSDK 1.0.1 (Three.js r181 + Havok physics in a worker), pinned: Meta's WebXR SDK for Quest, MIT, already the project base.
- **XR emulator in the web build:** IWSDK's IWER injected on build, skipped on phones and headsets: judges and players without a Quest can try it; restored in `58a87c9`.
- **Sculpting:** own SDF grid + chunked marching cubes in a Web Worker: deterministic, no dependency, edit operations replay exactly (needed for multiplayer).
- **Physics:** Havok through IWSDK with ClayMind's runtime extension (compound colliders, contact events); no continuous collision in IWSDK, so table / floor / wall colliders are thick slabs instead.
- **Game rules:** own Game Spec (versioned JSON, fixed triggers and actions) and a deterministic rule engine: the AI only fills data, never code.
- **Agent backend:** Python FastAPI + Agno 3.1.3 AgentOS (Apache-2.0) with A2A (a2a-sdk 0.3.26, pinned: 1.x was incompatible): one process, local A2A with an in-process fallback.
- **Models:** Groq free tier (gpt-oss-120b, qwen3.8-27b, gpt-oss-20b) behind a quota governor; strict JSON with Pydantic: free, fast, open-weight; reliability measured in `docs/EVAL_REPORT.md`.
- **Prompt-injection screen:** Groq llama-prompt-guard-2-86m on fetched web text.
- **Web search:** Wikipedia API only (free, no key, stable licence CC BY-SA); the game's own page first.
- **Embeddings:** BAAI/bge-small-en-v1.5 via fastembed (MIT / Apache-2.0), local, about 65 MB.
- **Multiplayer:** FastAPI WebSockets relay on the same backend (memory only), host-authoritative; IWSDK has no built-in networking; no WebRTC (no free TURN confirmed).
- **Snapshots on the wire:** gzip via the browser's CompressionStream + base64: no dependency.
- **Point + Say:** pure-code binder (2 s window, gesture weights) and intent rules in the client; the Intent Resolver (LLM) only names roles for items the code could not, and the pointing always wins.
- **Vision check:** Groq qwen3.8-27b (takes images, free tier) on the game's own rendered views (no camera: Quest Browser gives web apps none); off by default in Settings; one image with two views (~1.3k tokens each image, so 2-3 toys a minute).
- **Hosting:** GitHub Pages for the static client (already set up); backend host to be chosen in Phase 7.
