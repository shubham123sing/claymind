# ClayMind (working title)

Hands-only mixed-reality sculpting for Meta Quest 3/3S (WebXR). Shape clay, bring it to life as a physical object, and inspect and correct the AI's reasoning graph. The full brief is kept by the project owner. Phase status is tracked in `docs/`.

## Run (development)
1. `cd client && npm install`
2. `npm run dev` starts an HTTPS dev server on port 8081 and opens the IWSDK emulator browser.
3. Quest: same Wi-Fi, open `https://<your-pc-ip>:8081/` in Quest Browser, accept the certificate warning, then press **Enter XR**.
4. Tests: `npm test` · types: `npm run typecheck` · SDF bench: `npx vite-node tests/bench/sdf-bench.ts`

## Controls (Phases 1-2: sculpt, bring to life, play)
- **Quest (hands):** pinch the clay and pull to stretch it · point your index finger into it to dent · open palm on it to smooth · both hands pinching away from the clay to rotate/scale · turn your **left palm up** for the tool menu (Shape, Add, Carve, Smooth, Mirror, Undo, Redo, New clay) and poke a button with your right index finger. **Bring to life** turns the sculpt into a real object that flies onto your right palm; turn the hand over to drop it, or pinch an object to pick it up and throw it. **Material** cycles the material of the last object you touched.
- **Browser:** drag on the clay = pull (Shape) or use the selected tool · Shift+drag = poke · drag empty space = turn · 1-4 tools · M mirror · Ctrl+Z / Ctrl+Y · **Enter = bring to life** · drag an object to move it, **mouse wheel lifts it**, release to drop or throw · H debug HUD (`?debug`).

## Phase 0 spike pages
- `/?spikes`: MR scene. Ball drop on the table (real plane on Quest, virtual elsewhere), pinch probe, impact/CCD probe, camera probe (`?camera=1`). Keys: B drop · F fast shot · N spawn 10 · R clear · C camera.
- `/spikes/sdf.html`: SDF sculpt benchmark (`?res=64` for 64³).
- `/spikes/hands.html`: MediaPipe webcam hand tracking.

## Layout
- `client/`: IWSDK + Vite + TypeScript app (`src/core`, `src/platform`, `src/sculpt`, `src/spikes`, `src/devtools`)
- `docs/`: KNOWN_LIMITS, PERF, IDEAS (more per phase)
- `server/`, `assets/`: arrive in Phases 2 and 4
