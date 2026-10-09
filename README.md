# ClayMind (working title)

Hands-only mixed-reality sculpting for Meta Quest 3/3S (WebXR). Shape clay, bring it to life as a physical object, and inspect and correct the AI's reasoning graph. The full brief is kept by the project owner. Phase status is tracked in `docs/`.

## Run (development)
1. `cd client && npm install`
2. `npm run dev` starts an HTTPS dev server on port 8081 and opens the IWSDK emulator browser.
3. Quest: same Wi-Fi, open `https://<your-pc-ip>:8081/` in Quest Browser, accept the certificate warning, then press **Enter XR**.
4. Tests: `npm test` · types: `npm run typecheck` · SDF bench: `npx vite-node tests/bench/sdf-bench.ts`

## Phase 0 spike pages
- `/`: MR scene. Ball drop on the table (real plane on Quest, virtual elsewhere), pinch probe, impact/CCD probe, camera probe (`?camera=1`). Keys: B drop · F fast shot · N spawn 10 · R clear · C camera.
- `/spikes/sdf.html`: SDF sculpt benchmark (`?res=64` for 64³).
- `/spikes/hands.html`: MediaPipe webcam hand tracking.

## Layout
- `client/`: IWSDK + Vite + TypeScript app (`src/core`, `src/platform`, `src/sculpt`, `src/spikes`, `src/devtools`)
- `docs/`: KNOWN_LIMITS, PERF, IDEAS (more per phase)
- `server/`, `assets/`: arrive in Phases 2 and 4
