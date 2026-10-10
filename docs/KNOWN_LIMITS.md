# Known limits and spike results

Last updated: 2026-10-10 (Phase 4). Stack: `@iwsdk/core` 1.0.1, super-three 0.181, `@mediapipe/tasks-vision` 1.1.0.

Legend: **GO** = proven here · **GO (pending device)** = code works on desktop/emulator, needs a Quest number · **FALLBACK** = use the plan-B path.

## Go / no-go summary

| Piece | Verdict | Evidence |
|---|---|---|
| IWSDK MR scaffold (AR, hands, grabbing, physics, planes, meshes, hit-test, camera) | **GO** | `create-iwsdk --target ar`, typecheck clean, scene renders, Havok runs |
| Ball falls on table, bounces | **GO** (browser) / pending Quest (real table) | Virtual table: ball falls, bounces, 2 impacts detected (Δv 1.82 m/s, J 0.226 N·s). Real-plane collider code is in `table-system.ts`; untested on device |
| 1 Hand pinch + jitter | **GO (pending device)** | Detector + 1€ filter unit-tested; probe reads raw WebXR joints. Needs a Quest jitter number |
| 2 Contact events / CCD | **FALLBACK (decided)** | IWSDK exposes neither (see below). Velocity-delta impact detection works. Tunnelling test is built but not yet run (see "Open") |
| 3 Camera frames in Quest Browser | **UNKNOWN, needs device** | Probe built (`C` key / `?camera=1`). Core loop does not depend on it |
| 4 SDF sculpt 48³ | **GO**, 64³ is possible | Desktop worker: 3.7 ms p95 per stroke (48³), 4.5 ms (64³), off the main thread. Quest is roughly 3-4× slower, so expect about 11-15 ms in the worker: OK as async, but tighten dirty-chunk marking in Phase 1 |
| 5 MediaPipe webcam hands | **GO (pending your webcam)** | Page built and typechecked; needs a human with a camera |

## Details

### Physics (IWSDK 1.0.1)
- **No collision/contact events and no CCD flag.** I read `physics-runtime.js` and `physics-system.js`. The Havok engine lives inside a worker; IWSDK only sends pose, velocity and impulse commands and reads back pose and velocity.
- **Body velocity is mirrored to the main thread every step** (`PhysicsBody._linearVelocity`). Impact = |Δv| above 0.6 m/s between physics steps; impulse ≈ m·|Δv|. Gravity alone is 0.136 m/s per step at 72 Hz, so the threshold is well clear. Implemented in `src/spikes/impact-probe-system.ts`.
- Fallback if Δv misses fast hits or tunnelling is bad: run physics on the main thread (`useWorker: false`) and call Havok `HP_World_GetCollisionEvents` ourselves, or clamp max speed and use thicker static colliders (≥ 4 cm).
- **Physics reads `object3D.position` in LOCAL space.** Physics bodies must be root-level entities, never children. Plane colliders are created at root with copied world poses.
- `updateFrequency` set to 72 Hz to match the Quest display rate (the default is 60).
- Mass = `density` × collider volume (density in kg/m³ works fine: 124 g rubber ball, r = 3 cm).

### Input
- `GrabSystem.useHandPinchForGrab` defaults to false; we read raw `XRHand` joints instead (thumb-tip and index-tip distance with hysteresis: 1.5 cm start, 3 cm end, 6-frame tracking-loss grace).
- Joint poses are read relative to `renderer.xr.getReferenceSpace()`. This matches world space only while the player rig sits at the origin, which holds for us (seated, no locomotion).

### Camera
- `features.camera: true` registers `CameraSystem`. `CameraSource` is getUserMedia-based. Whether Quest Browser returns passthrough frames inside an immersive session is unknown until tested. The photo bonus is optional; plan B is a phone upload.

### Dev tooling
- The IWSDK managed Chromium (`iwsdk dev up`) **cannot launch from the agent sandbox on this PC** (`spawn UNKNOWN`). You can run it yourself with `npm run dev`.
- For agent checks, `IWSDK_HTTP=1` serves plain HTTP on localhost (port 5190, via `.claude/launch.json`). Use HTTPS (default) for the headset.
- The browser pane only animates while it is visible (rAF stops when hidden).

### Phase 1 findings
- **Table choice:** the first table-height plane is not necessarily the right one. In IWER's living room it was a coffee table 2.3 m away. We now pick the table plane nearest the user and only accept it if its edge is within 0.5 m of the head (seated reach). Otherwise the virtual table stays.
- **Camera prompt:** `features.camera` is now **off**, so players get no permission prompt; `?spikes` registers `CameraSystem` itself. The built-in browser still reports a camera request on the *dev* server (IWER runtime), but not on the production build.
- **IWER scripting:** hands and head can be scripted by setting `IWER_DEVICE.controlMode = 'programmatic'`. In `manual` mode the DevUI overwrites poses every frame. This is how the XR hand path and the wrist menu were exercised without a headset.
- **Mouse sculpting:** dragging aims at the surface *as it was when the press began* (snapshot raycast). Aiming at the live surface drilled holes (carve) or grew towers toward the camera (add).
- **Resolution:** 48³ (5.3 mm voxels). Carved edges show slight scalloping at grazing angles. 64³ costs about the same per stroke on desktop (`?res=64`); pick the default once Quest numbers are in. The client lowers resolution automatically if worker p90 > 14 ms.
- **Not yet verified on a real Quest:** hand tracking feel, 72 fps while sculpting, wrist-menu reachability, real-table placement.

### Phase 2 findings (objects + physics)
- **Sleeping bodies:** a body that is teleported every frame with zero velocity (held / hovering) gets put to sleep by Havok, and setting `gravityFactor` back to 1 does **not** wake it. On release we always set a velocity via `PhysicsManipulation`, at least `[0, -0.01, 0]`.
- **Entity index reuse:** disposing an entity and creating another soon after reuses the index. The physics worker and index-keyed maps then confuse the two bodies (seen as sinking through the table, no impacts, disappearing). Rules: create the replacement **before** disposing the old one, and debounce body rebuilds (material changes rebuild 400 ms after the last click; visuals change instantly).
- **Convex hull mass:** Havok computes mass from the hull volume. We set `density = ρ × V_mesh / V_hull` so mass = ρ × true volume (a mug is not weighed as a full cylinder).
- **Shape changes need a new body:** `PhysicsShape` fields (density, friction, restitution) are not reactive in IWSDK 1.0.1.
- **Matching is shape-only:** features are proportions, fill, a 5-slice profile, open top and through-holes. A sculpted mug *without* a closed handle loop reads as mug, bowl or vase depending on proportions. Below 0.7 similarity the user's own sculpt is kept and labelled "a bit like a (template)?".
- **Browser lifting:** the default browser view tops out near eye height, so the mouse wheel lifts a held object (up to 1.6 m) to allow breaking drops.
- **Seated reach:** creations resting out of reach (floor, beyond 0.9 m) float back to the table after 1.5 s.
- **Not verified on Quest:** hold/throw feel, bake time (desktop 76-192 ms), impact sound latency.

### Phase 3 findings (Knowledge Graph)
- **Layout:** a deterministic **layered** layout (creation → concept/material/feature → property → behaviour, with barycentre ordering) replaces the force layout in the brief. It reads as a reasoning chain, never jitters and needs no worker. Positions glide on changes.
- **Connect relation:** instead of a radial relation menu, dragging node A onto node B picks the relation from the node types (e.g. Material → Property = `has_property`, Property → Behavior = `causes`). Impossible pairs are refused with a message. A radial menu can come in Phase 7 polish if needed.
- **Pinch grace window:** when a pinch starts, the thumb-index midpoint is still moving (fingers closing + 1€ smoothing), so the first frame misses small targets. Brain grabs accept a target during the first 200 ms of a pinch. Object grabs have larger margins and did not need it.
- **Multiple reasons:** cutting one belief may not change a prediction if another, stronger path supports it. The card says so ("predictions unchanged (stronger beliefs still support them)" or "… still 67% because Ball → bouncy").
- **Browser camera:** while the brain is open in the browser, the camera eases back and up to frame the clay, graph and card; it returns when the brain closes. XR is unaffected.
- **Storage:** IndexedDB, falling back to memory. A stuck database (e.g. a pending delete) times out after 1.5 s and the game starts from the seed brain.
- **Not verified on Quest:** label readability at arm's length, reach to the graph (placed 36 cm above the table, 8 cm behind the clay), card poke comfort.

### Phase 4 findings (AI layer)
- **Mock-first:** no API keys are configured. The server runs `mock` providers by default; a static build with no server uses the in-browser `LocalMockProvider` with the shipped sample models (`public/samples`). The real adapters (Claude vision, fal.ai queue) are written and unit-tested with stubbed clients, but **have not been called against the live services**.
- **Mock honesty:** the mock vision model cannot see images. It answers from the local shape hints (best template match, open top, holes), so mock answers mirror the local matcher. A sculpt with no template sample (e.g. a "spaceship") gets no generated model: the object stays the local one, as with a real provider failure.
- **fal.ai model ids** (`FAL_3D_MODEL`, `FAL_IMAGE_MODEL`) and their output field names change over time; they are configuration and must be verified on fal.ai before enabling. The result parser accepts `model_mesh` / `model_glb` / `mesh` / `glb` URL fields.
- **Generated meshes:** no decimation yet. Models above 80k triangles are refused and the local object is kept; samples are 2.4k-21k triangles. Real Trellis output may need its simplify option or a decimation pass (Phase 7).
- **Model look:** the swapped-in model uses the game material (colour/roughness from `materials.json`), not the generated texture, so material edits, physics and the brain stay consistent. Textured AI models are a Phase 7 polish option.
- **Size:** generated models are scaled so their bounding-box volume matches the sculpt's (keeps mass sensible), not their largest side.
- **Which objects get a new model:** only objects that kept the raw sculpt or matched a template below 0.85. Clean template matches skip image-to-3D (no cost, already clean).
- **Waiting is never blocking:** the local object exists immediately; AI progress shows on its label ("AI is looking…", "Making a clean model 40%"). Any failure shows "AI unavailable · kept the local result" for 4 s.
- **Privacy:** only offscreen renders of the sculpt (3 PNGs, 320 px) are sent, never camera frames. The first real (non-mock) request shows "sculpt renders are sent to the AI service" once. The **AI** menu button turns AI off (`?ai=off` too).
- **Caching (gets faster with use):** client IndexedDB `ai` store keyed by a quantised shape descriptor + size + provider; the server also caches by content hash. Measured with the mock server: describe 1.2 s first, 21 ms cached; model 6.2 s first, 0.01 s cached.
- **Spend:** costs per call are estimates (`COST_*_USD`); the monthly cap (`SPEND_CAP_USD`, default $5) is enforced before any paid call.
- **Not verified:** the in-game server path in the browser pane (the pane was hidden; covered instead by `tests/integration/server-roundtrip.ts` against the running server, plus the in-game mock path); anything on Quest.

### Phase 5 findings (agent, Debug the Brain, Mastery)
- **The agent is code, not an LLM.** It plans tests from the brain (`planTests`), runs real physics experiments, and decides from measurements with fixed thresholds. Every step is shown (observe / plan / act / result / update / ask / report), at most 8 per run. It never changes a belief without asking; every change can be undone from the brain card.
- **Signature demo verified in the browser with real clicks:** Bring to life -> Check beliefs -> a 722 g steel ball and a 6 g foam ball dropped from 40 cm "landed together (within 1 ms)" -> "heavy causes falls faster" pulses red (disputed) -> "Remove it" -> "Updated: falls faster 65% -> 0%". About 16 s from Bring to life to the report.
- **Fall-time measurement:** frame timestamps are too coarse (a 72 Hz frame is 14 ms), so the gap is measured in space: when the first ball touches down, the other ball's height is converted to time at the impact speed. Only "heavy first by more than 20 ms" counts as support; a light ball landing first never does.
- **Fixed during verification:** (1) bodies created on different frames gave the first experiment a ~40 ms head start: balls are now created with gravity off and released in the same frame once both exist in the engine. (2) a ball bounced off the user's creation and faked a 74 ms result: the experiment spot now avoids objects on the table (tries right, further right, then left), and a touchdown only counts near the table top.
- **Experiments:** drop-compare, drop-break (a copy of the creation from 50 cm; the copy is removed after 12 s and does not count toward the 4-object limit), bounce (30 cm). Results the brain did not predict (e.g. plastic breaking) are proposed as new beliefs with source `experiment`.
- **Memory:** experiments are remembered per belief version (IndexedDB `settings/agent-memory`); an unchanged belief is not re-tested ("already tested"), counted on Mastery as experiments saved.
- **Material question:** 7 s after Bring to life, if material confidence is below 50% and the user has not corrected it, the agent asks with the top guesses as buttons. Logic is unit-tested; in the browser the default sculpt matches confidently, so the question was not triggered in the click test.
- **Mastery screen:** honest mechanisms only: time to object (first vs now), AI answer time, material guesses kept, beliefs taught or fixed, experiments run / saved, brain size, AI cache hits. Saved in IndexedDB. Not "the AI learned you".
- **Not verified:** poke interaction with the agent and Mastery panels on Quest (code path shared with the brain card); drop-break and bounce only via unit tests and the JS console, not a full click run.

### Other
- MediaPipe wasm is copied locally (`scripts/copy-vendor.mjs`). The hand **model** still loads from storage.googleapis.com; vendor it before the judge build (Phase 7).
- `@types/three` mis-declares the `edgeTable`/`triTable` types; cast in `marching-cubes.ts`.

## Open: what only a Quest can answer (Phase 0 device checklist)
1. Main app on Quest → Enter XR → does the ball land on the **real table**? (HUD `surface` line says REAL or virtual.)
2. Pinch and hold a hand still for 2 s. Read `hand L/R … best X->Y mm` (raw → filtered jitter).
3. Press the fast-shot test (desktop button or `F`). Read the `ccd` line: stopped vs tunnelled at 5/10/20 m/s.
4. Open `https://<pc-ip>:8081/?camera=1` → Enter XR → read the `camera` line.
5. Open `/spikes/sdf.html` in Quest Browser → Run benchmark → read worker p95 and frame ms.
6. Open `/spikes/hands.html` on a laptop/phone → Start camera → read fps and inference ms.
