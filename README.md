# ClayMind (working title)

Hands-only mixed-reality sculpting for Meta Quest 3/3S (WebXR). Shape clay, bring it to life as a physical object, and inspect and correct the AI's reasoning graph. The full brief is kept by the project owner. Phase status is tracked in `docs/`.

## Run (development)
1. `cd client && npm install`
2. `npm run dev` starts an HTTPS dev server on port 8081 and opens the IWSDK emulator browser.
3. Quest: same Wi-Fi, open `https://<your-pc-ip>:8081/` in Quest Browser, accept the certificate warning, then press **Enter XR**.
4. Tests: `npm test` · types: `npm run typecheck` · SDF bench: `npx vite-node tests/bench/sdf-bench.ts`

## Controls (Phases 1-5: sculpt, bring to life, play, edit and debug the brain)
- **Quest (hands):** pinch the clay and pull to stretch it · point your index finger into it to dent · open palm on it to smooth · both hands pinching away from the clay to rotate/scale · turn your **left palm up** for the tool menu (Shape, Add, Carve, Smooth, Mirror, Undo, Redo, Material, Brain, Check beliefs, Mastery, AI, New clay) and poke a button with your right index finger. **Bring to life** turns the sculpt into a real object that flies onto your right palm; turn the hand over to drop it, or pinch an object to pick it up and throw it. **Material** cycles the material of the last object you touched.
- **Browser:** drag on the clay = pull (Shape) or use the selected tool · Shift+drag = poke · drag empty space = turn · 1-4 tools · M mirror · Ctrl+Z / Ctrl+Y · **Enter = bring to life** · drag an object to move it, **mouse wheel lifts it**, release to drop or throw · G brain · B check beliefs · P mastery · H debug HUD (`?debug`).

## Phase 0 spike pages
- `/?spikes`: MR scene. Ball drop on the table (real plane on Quest, virtual elsewhere), pinch probe, impact/CCD probe, camera probe (`?camera=1`). Keys: B drop · F fast shot · N spawn 10 · R clear · C camera.
- `/spikes/sdf.html`: SDF sculpt benchmark (`?res=64` for 64³).
- `/spikes/hands.html`: MediaPipe webcam hand tracking.

## Layout
- `client/`: IWSDK + Vite + TypeScript app (`src/core`, `src/platform`, `src/sculpt`, `src/spikes`, `src/devtools`)
- `docs/`: KNOWN_LIMITS, PERF, IDEAS (more per phase)
- `server/`, `assets/`: arrive in Phases 2 and 4

> **Plan v3 (`docs/PLAN.md`, from 2026-10-10):** the brain graph, Debug the Brain and Mastery below are hidden from players; open the game with `?devKgView` to see them. The brain still runs internally.

## The brain (Phase 3)
After **Bring to life**, the AI's reasoning graph appears above the table (toggle: **Brain** in the menu, or `G`). Each prediction comes from the graph:
- **Cut a belief:** pinch (or mouse-drag) an edge's middle handle and pull it away.
- **Add a belief:** pinch-drag (or mouse-drag) from one node onto another.
- **Why?** Tap a prediction on the card; its reasoning path lights up step by step.
- **Undo edit / Reset brain / Overview** are on the card. The card shows what each edit changed, e.g. "bounces 67% → 0%".
- The brain is saved in the browser (IndexedDB) and survives reloads.

## Debug the Brain and Mastery (Phase 5)
- **Check beliefs** (menu, the agent panel's button, or `B`): the agent picks the belief about your object that is most worth testing, runs a real physics experiment on the table beside the clay, and shows each step. If the result contradicts a belief, the edge pulses red and the agent asks before removing it (or lowers its confidence if you keep it). The starting brain holds one deliberately wrong belief, "heavy things fall faster", so the first check shows this.
- If the material guess is unsure, the agent asks which material you meant.
- **Mastery** (menu or `P`): time to object, material guesses kept, beliefs fixed, experiments run and saved by memory, brain size, AI cache hits.

## AI layer (Phase 4, optional)
The game works fully offline: Bring to life always creates the object locally first. On top of that, the AI layer looks at the sculpt, names it, refines the material guess (the brain gains AI beliefs), and for raw sculpts swaps in a clean generated model, with progress on the object's label.

- **No server** (static build, judges): an in-browser mock with shipped sample models.
- **Local server:** see `server/README.md` (mock providers by default; Claude vision and fal.ai image-to-3D when keys are set). In dev the game finds it at `/api` automatically.
- URL options: `?ai=off|mock|server|auto`, `?aiUrl=https://…`. The **AI** button in the menu turns it on and off.
