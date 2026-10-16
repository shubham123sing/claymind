# Known limits and spike results

Last updated: 2026-10-10 (Phase 4). Stack: `@iwsdk/core` 1.0.1, super-three 0.181, `@mediapipe/tasks-vision` 1.1.0.

Legend: **GO** = proven here · **GO (pending device)** = code works on desktop/emulator, needs a Quest number · **FALLBACK** = use the plan-B path.

## Go / no-go summary

| Piece | Verdict | Evidence |
|---|---|---|
| IWSDK MR scaffold (AR, hands, grabbing, physics, planes, meshes, hit-test, camera) | **GO** | `create-iwsdk --target ar`, typecheck clean, scene renders, Havok runs |
| Ball falls on table, bounces | **GO** (browser) / pending Quest (real table) | Virtual table: ball falls, bounces, 2 impacts detected (Δv 1.82 m/s, J 0.226 N·s). Real-plane collider code is in `table-system.ts`; untested on device |
| 1 Hand pinch + jitter | **GO (pending device)** | Detector + 1€ filter unit-tested; probe reads raw WebXR joints. Needs a Quest jitter number |
| 2 Contact events / CCD | **FALLBACK (decided, 6a measured)** | IWSDK exposes neither. Velocity-delta impacts and chain-of-contact inference work; spheres hold to 30 m/s, 5 mm plates tunnel at >= 12 m/s (cap 6 m/s) |
| 6a Multi-material object | **GO (one body + COM override)** | No compound shapes/joints; `centerOfMass` override makes tipping follow our computed COM (headless Havok test) |
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

### Phase 6a spike (plan v3: multi-material physics)
Run headless on IWSDK 1.0.1's own `PhysicsRuntime` (the code inside the physics worker) with Havok at 72 Hz: `tests/physics/spike-6a.test.ts`, harness `tests/physics/havok-sim.ts` (no browser needed; part of `npm test`).
- **One shape per body, no joints/constraints** in IWSDK's ECS physics. Compound shapes with per-shape materials are not possible without bypassing IWSDK. **Chosen path:** one body per assembly = one convex hull of all pieces + our own mass (density) and **`PhysicsBody.centerOfMass` override** (local space; default `Infinity` = Havok computes it). The value is passed through `physics-system.js` -> worker -> `HP_Body_SetMassProperties`.
- **COM override works:** a 4x16x4 cm box with the auto COM stays upright (0.3 deg); with COM +3 cm / -3 cm in x (outside its 2 cm half-width) it tips to +x / -x (90 deg); the same with a convex hull. With COM 6 cm low, a spin kick that topples the centred box leaves it at 0.4 deg. So tipping follows the centre of mass we compute.
- **Per-piece friction/restitution** cannot differ inside one body: one value per body (plan: the piece touching the surface). A convex hull fills concave gaps (an L shape collides as its hull).
- **Chain of contact without contact events works:** ball (1.4 m/s) -> block A -> block B was inferred exactly from per-step velocity changes plus proximity (a body that speeds up while a neighbour within 1.5 cm slows down was pushed by it): events at 83 ms (ball -> A) and 97 ms (A -> B).
- **Tunnelling (no CCD flag):** 2 cm spheres never passed a 1 cm wall or the 3 cm table up to 30 m/s (Havok speculative contacts). A 5 mm thin plate passed a 1 cm wall at >= 12 m/s, held at <= 8 m/s. Throw cap stays 6 m/s; minimum piece thickness 8 mm in 6b.
- **Not checked yet:** thin dynamic piece vs dynamic piece at speed; the same numbers on Quest (same wasm, so physics results should match; only timing differs).
- **Brain UI hidden:** `devKgView` flag (`?devKgView` to show). Players see no graph, no agent panel, no Mastery; Brain / Check beliefs / Mastery leave the menu and the G/B/P keys. The brain still records creations, materials and corrections internally (verified in the browser: 50 nodes, view hidden).

### Phase 6b findings (pieces, per-piece materials, matchups, breaking)
- **Pieces:** one sculpt grid with a piece label per sample (max 4 pieces). "New piece" (menu or `N`) switches to Add; the next Add stroke lays down the new piece in its own clay tint, later Add strokes extend whichever piece they touch, drag carries labels, undo/redo restore them. Pieces are joined because they are one lump; there is no automatic splitting (plan). Template matching is skipped for multi-piece sculpts (a template has no pieces); a generated AI model only replaces single-piece objects.
- **One body per object** (6a): convex hull of all parts, mass and centre of mass from `computePhysicalProperties` (exact signed-tetrahedra integration of each part's closed mesh), friction/bounce from the part touching the surface times the matchup with the surface (table = wood, floor = stone).
- **Acceptance, headless on IWSDK's Havok** (`tests/physics/hammer-6b.test.ts`): stone-head hammer 276 g vs all-wood 118 g; with a table edge between their centres of mass the stone one stays and the wood one falls, as predicted; the stone head knocks a stone block away at 0.74 vs 0.52 m/s; dropped head-first 15 cm onto a 145 g glass ball the glass feels 2.59 m/s (breaks at 1.9) vs 0.51 m/s with the wood head.
- **Acceptance in the browser:** a sculpted hammer (handle piece + head piece) baked into 2 parts; set to wood + stone the label reads "Wood + Stone · 326 g" and the stone head sets friction; placed with the handle over the table edge it stays, switched to an all-wood head it falls (COM 6.6 cm vs 4.5 cm, edge at 5.6 cm), switched back it stays.
- **Not verified in the browser:** the glass-break hit (the browser pane was hidden after the dev server restart; the crush rule was added after the first in-game try, where breaking used only the struck object's own velocity change and a ball pinned on the table never broke). Verified headless with the same `feltSpeed` function.
- **Breaking:** a hit checks the part that took it (the part reaching furthest against the velocity change) and the other material (nearest object part, else table/floor): felt = max(own dv, impactor impulse / own mass) x matchup damage, against that part's breakSpeed. Only that part shatters into its own pre-baked shards; the rest of the object stays one body (it may then be two disconnected pieces sharing one body: a limit).
- **IWSDK Box colliders round their edges by ~1.4 cm** (an object with its centre of mass 12 mm inside a Box table's edge fell off; a ConvexHull table holds to the edge). The table colliders are now convex hulls. The dynamic Box shape tipped with its COM 8 mm inside its base; creations always use hulls.
- **Havok combines friction by MIN and restitution by MAX.** Table and floor now use friction 1 and restitution 0, so the object's own material (and the matchup) decides. Before, every object bounced at least like the table (0.2).
- **Bug fixed from Phase 1: Carve.** The carve brush computed an intersection instead of a subtraction, so Carve and the finger poke only shaved a thin shell outside the brush. Now a true smooth subtraction (`tests/unit/carve.test.ts`).
- **Materials 12 -> 8** (plan): steel, stone, wood, rubber, plastic, glass, foam, clay. Old ids map: ceramic -> glass, aluminium -> steel, cloth/paper -> foam (`normalizeMaterialId`). Mugs/bowls/plates/vases now lean glass or plastic. Saved brains may still hold nodes for removed materials until "Reset brain" (the brain view is hidden in plan v3).

### Phase 6a spikes for plan v4 (2026-10-10)
Headless tests call the Havok build IWSDK ships, through IWSDK's runtime (`tests/physics/spike-v4.test.ts`):
- **(a) several materials on one body: GO (with the runtime extension).** A Havok container of a steel and a wood box gets mass 8.500 kg and COM -4.24 cm, exactly the density-weighted values; each child keeps its own friction (a sled with a rubber and a slick runner turns 75 deg while sliding, equal runners 0.1 deg). IWSDK's component cannot express this, so ClayMind swaps the worker-side runtime (see PLAN.md notes): verified in dev (worker imports `/src/physics/runtime/physics-runtime-ext.ts`), in the build (marker in `physics-worker-*.js`) and in the live page (worker log line).
- **(b) contact impulse events: GO (runtime extension); CCD: no flag.** Havok reports the two bodies, the contact point and the impulse (0.919 N·s for a 294 g ball at 3.0 m/s; m·v = 0.881). Tunnelling numbers from the first 6a stand (spheres hold to 30 m/s; 5 mm plates tunnel from 12 m/s; throw cap 6 m/s).
- **(c) dynamic cup of boxes holding ~10 pebbles: GO.** A 40-box cup (base + 39 wall boxes, 9 cm wide) holds 10/10 pebbles after the pour and keeps them when tossed 4 cm up; a 5-box cup leaks 1 through its corner gaps. 0.80 ms per 72 Hz step for the whole world on desktop (Quest estimate 3-4x: ~3 ms, in the physics worker).
- **(d) anchor persistence in Quest Browser: NOT RUN (needs the headset).**
- **(e) distance grab of a physics body: NOT RUN in XR.** The hold code already moves a body kinematically at any distance (mouse drags in the browser do exactly that); the XR ray part needs the emulator/headset.
- **(f) painting cost: vertex colours chosen.** Desktop, res 48: one 1 cm paint dab (re-mesh the dirty chunks + colour their vertices) 0.63 ms; colouring the whole surface 0.71 ms; full re-mesh 5.0 ms (res 64: 1.24 / 0.79 / 14.9 ms). A 64^3 3D texture would cost ~0 ms to write but a 1 MB upload per dab. Quest not measured. Paint detail = grid spacing (~5 mm at 48^3).
- **6b in the browser, re-checked:** a wood-head hammer dropped on a 139 g glass ball: felt 0.76 m/s, no break; stone head: felt 5.08 m/s, shattered. Fixed on the way: in object-object hits the hitting part is now the part nearest the other object (a flat-falling hammer was reported as hitting with its handle).
- **No AI / no network** (plan v4): with default URLs the page makes no AI/server requests (checked: no `/api` or vendor requests; the AI system is not registered). New pieces start as clay; templates never replace the sculpt.

### Phase 6b for plan v4 (compound bodies, collision events, Join / Separate, material picker)
- **One body per object, one Havok child per piece** (each with its own density, friction and bounce) through ClayMind's runtime extension: the compound description travels in the hull vertex buffer of an invisible "carrier" mesh (`src/physics/runtime/compound-format.ts`); each piece is drawn as its own mesh under it. Child densities are scaled so the body's mass equals `computePhysicalProperties`; the centre of mass is ours (Havok's container COM matched ours to 0.01 mm in the test).
- **Hollow pieces get boxes:** a piece whose volume is < 75% of its slice-stacked envelope becomes up to 40 axis-aligned boxes merged from its voxels (`src/objects/collider.ts`); others get a hull (<= 256 points). In the browser a sculpted stone cup (539 g) got 30 boxes and held 10/10 pebbles; a rod and a capsule get hulls. Limits: thin walls under ~1 cell can drop out at coarse cell sizes; boxes are axis-aligned in the piece's frame.
- **Collision events drive sound and breaking:** the worker posts every new contact (bodies, point, impulse) on a BroadcastChannel; each object feels impulse / its mass x the matchup, at its piece nearest the contact. The old velocity-change path stays as a fallback and goes quiet once events arrive. Browser: hammer onto a 139 g glass ball, wood head 0.112 N·s -> 0.81 m/s felt (no break), stone head 0.300 N·s -> 3.04 m/s felt (shattered).
- **Bug found and fixed:** IWSDK asks for several physics sub-steps in one call after a slow frame, and Havok keeps only the last sub-step's events, so hits were lost (the browser pane ran at ~1-2 fps at times). The extension now runs sub-steps one at a time and copies the last results back; a test checks 72 sub-steps in one call give the same contacts and position as 72 single steps.
- **Tipping (browser, compound body):** hammer on the table edge, stone head stays (COM 7.2 cm, edge 6.2 cm), all-wood falls (COM 5.1 cm), stone again stays.
- **Join / Separate (menu, `J` / `K`):** Separate makes the touched piece its own object (nudged 4 mm apart); Join merges the touched object with one whose surface is within 1.2 cm, keeping every piece exactly where it is (piece frames). Browser: hammer separated into 100 g + 192 g, joined back into 2 pieces, 292 g. A joined object can contain pieces that only touch at a point: they move as one rigid body.
- **Material picker (menu `Material`, `T`):** a ring of the 8 materials on the touched piece; the centre and the toast say what it means ("Stone · heavy, fragile", "Rubber · medium weight, bouncy, grippy"; from the numbers in materials.json). Real mouse click verified. Fixed while testing: it opened out of view above tall objects, and a glide animation made it slip away from the click at low frame rates (it now snaps to its spot every frame). In the headset it is 20 cm across in front of the object (3.5 cm buttons); on the desktop half size.
- **Not verified:** poking the picker with a fingertip in XR; frame time on Quest.

### Phase 7 (colour and painting)
- **Paint lives in the sculpt grid** (RGBA per sample, alpha 0 = unpainted) and goes through the same stroke history as sculpting, so Undo / Redo cover it. Pulled clay carries its paint, new clay comes unpainted, carving reveals unpainted clay, smoothing borrows a neighbour's paint. Bring to life samples it onto each piece mesh and its breakage shards. Tests: `tests/unit/paint.test.ts`.
- **Browser check:** painted a blue wavy stripe and three yellow dots, then pulled the clay out through the stripe and added clay beside it: the stripe stays on the pulled surface, the new clay is unpainted. After Bring to life the object kept all 1,705 painted vertices; "Whole piece" made it green with the paint on top; mass unchanged (1,241 g); switching to steel kept colour and paint (5,412 g).
- **Resolution:** paint follows the grid (~5 mm at 48^3), so edges are blocky and a dot is never smaller than ~5 mm (the plan's 3 mm minimum brush paints ~5 mm).
- **Colour = looks only:** the piece colour and paint are vertex colours; the material keeps its PBR look (steel stays metallic, rubber matte). Physics never reads colour.
- **Colour picker** (menu `Color`, `C`): hue ring, lightness bar, 8 swatches, Whole piece, Material colour, Paint / Eraser, brush - / + (also `[` `]`). It applies to the object if one was touched after the clay, else to the clay piece last touched. Desktop: beside the clay on the right; headset: on the left, 27 cm wide.
- **Brush size** is set with - / + (and `[` `]`), not the thumb-index pinch slider of the plan (a slider needs XR testing first).
- **Painting with the mouse at very low frame rates** (the browser pane ran at ~2 fps at times) samples a fast drag only once or twice; strokes are then gaps. Normal frame rates are fine.
- **Desktop toolbar moved** to a two-column panel on the left; it had grown to 17 buttons and covered the clay.
- **Not verified:** fingertip painting in XR, Quest frame time while painting (desktop worker ~0.6 ms per dab).
- **Only the clay can be painted**; an object's pieces can be recoloured (Whole piece) but not painted after Bring to life.

### Phase 8 (room placement)
- **Acceptance in the browser:** a sculpted cup, painted with a yellow ring and a blue band, made stone, put near the table edge and pinned; after a reload it came back pinned at the same spot (surface frame x 0.3398 / y 0.0471 / z 0.101, identical), stone, all 7,772 painted vertices. Play Kit pebbles poured over it: 10/10 inside the pinned cup.
- **Pin / Unpin** (menu, `P`): pinned = a static Havok body (the compound with its boxes, so pinned cups hold things), snapped down onto the table / floor when its lowest point is within 3 cm above (or 1 cm into) it. Grabbing a pinned object unpins it. Pinned objects are never recalled.
- **Library** (menu, `L`): every creation is saved to IndexedDB automatically (0.8 s after it changes: bring to life, material, colour, pin, join, separate), with its baked pieces (meshes, paint, colliders, shards, frames), thumbnail (128 px JPEG, ~3 KB) and pose relative to the work surface. Pinned creations come back on load; others wait on the shelf; tap a thumbnail to bring one back (pinned: to its spot; else beside the clay), tap x twice to delete. A creation joined into another is removed from the Library. Breaking does not save, so the Library keeps the last whole version.
- **Anchors not used:** pinned poses are stored relative to the work surface (spike 6a-d is still unverified on Quest). When a real table is found after loading, a toast points to Library -> "Re-place pinned". If the table is a different size, pinned things keep their offset from its centre.
- **Size per saved creation:** the baked meshes and shards are stored as-is (a 2-piece object is roughly 1-3 MB). Not yet measured how many fit within Quest Browser's storage quota.
- **Play Kit** (menu, `O`): 10 pebbles (stone and rubber), a row of 7 wooden dominoes, a glass plate that breaks; spawned on the table left of the clay; pressing it again resets the kit. Kit items are props: grabbable, never saved, not limited like shards.
- **Distance grab (XR):** a pinch that is not near an object casts a ray from an estimated shoulder through the pinch; the object it hits (up to 3 m) follows the ray at its distance. **Not verified** (needs the headset / emulator hands); in the browser the mouse already grabs at any distance.
- **Seen while testing:** the browser pane's mouse can be used by the person watching at the same time; strokes then appear on the clay (13 drag strokes in 3 s without any scripted input). Not a bug, noted so the spiky clay in screenshots is explained.

### Phase 9 (polish), first pass
- **First five minutes:** a card above the clay walks through shape -> colour / paint -> Bring to life -> material -> pin; each step advances when the player does it; Skip any time; shown once (Settings -> Tutorial again); ends with the time taken. Browser: steps 1-3 advanced on real actions (a drag, a paint dab, Bring to life). Steps 4-5 not yet re-checked after the fix below (the browser pane was hidden).
- **Bug found and fixed:** a Pin (or Join, Separate, break) right after a material change rebuilt the body from the old material, so the change was lost (seen in the browser: pinned but still clay). Materials waiting to be built in are now committed first everywhere a body is rebuilt or saved.
- **Samples:** on the first run the Library gets a hammer (wood + stone, 321 g), a painted cup (white stone, blue band, 425 g) and a striped rubber ball (206 g), with thumbnails (browser: all three appeared, thumbnails correct).
- **Settings** (menu `Settings`, key `S`): reduced motion (no hover bob, no clay breathing, menus without easing), high contrast (solid black panels, white outlines, in all canvas panels and the wrist menu), left-handed (the left hand catches new creations; the right palm opens the menu), one-handed menu (the menu stays open beside the clay in XR, either hand pokes it), sound on / off (suspends the audio context), tutorial again, reset everything (two taps: deletes the IndexedDB database and reloads). Not yet checked in the browser or headset.
- **Looks:** steel, glass and other materials reflect a small generated room environment (three's RoomEnvironment through PMREM, made once on the device, no download). Not yet compared side by side in the browser.
- **Sounds:** pin (chime), unpin (tick), join (chime), separate (snip), tutorial steps (chime), on top of the existing UI ticks and material impacts.
- **No flashing above 3 Hz:** the only pulsing is the clay breathing while baking (~0.9 Hz; off with reduced motion).
- **Performance:** panels that follow the clay no longer allocate vectors every frame. Quest frame time still not measured.
- **The browser pane is slow at times** (0.6-1.3 s per frame while hidden or in the background) and the page only starts while the pane is visible; checks that need several frames were done when it was visible.

### Phase 9 (polish), second pass: verified in the browser
- **Tutorial, all 5 steps** advanced on real actions (drag, paint dab, Bring to life, material, Pin) and ended with "Done in 0:17! It is saved in your Library." Pinning straight after choosing steel kept steel (5.30 kg): the lost-material fix holds.
- **Settings by real clicks:** High contrast turned every canvas panel solid black with white outlines (and now the HTML toolbar too); Reduced motion stopped the hover bob (0 mm vs ~10 mm); Sound off muted everything; all three survived a reload. **Reset everything** (two taps) brought back defaults, the tutorial and the 3 samples, and removed the pinned creation.
- **Steel now reflects** the generated room environment (clearly shiny instead of flat grey).
- **Impact effects by material:** sparks off metal, chips off stone / glass, a soft puff off clay / foam / rubber (in addition to material sounds).
- **Readable in the headset:** headset panels are drawn 25% larger so body text is >= ~2.5 cm at 1 m equivalent at the ~0.5 m they float from the eyes.
- **Scene cost** with the Play Kit, 3 samples and a pinned creation: 22 bodies, 77 draw calls, 30.7k triangles (browser). Quest frame time still not measured; the browser pane's own frame time (18 ms when active) is not meaningful while it is throttled.
- **Not verified:** Left-handed and One-handed menu (need hands in XR); poking panels in XR.

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

## Update 1, Step 0: phone AR diagnosis (2026-10-13)
Root cause (code): **in phone AR there is no input at all.** `PointerProvider.active()` is false whenever an XR session runs, and `XrHandsProvider` reads only `inputSource.hand`. A phone has no hands: screen taps arrive as transient XR input sources (`targetRayMode: 'screen'`, `select*` events) that nothing reads. DOM pointer events do not reach the canvas in AR either, so the canvas-drawn menus (picker, Library, Settings) cannot be tapped.
Other findings:
- Session (IWSDK `buildSessionInit`): `immersive-ar` with optional `local-floor`, `hit-test`, `anchors`, `plane-detection`, `mesh-detection`, `hand-tracking`. **No `dom-overlay`** (IWSDK has no option for it), so there are no HTML menus in AR.
- Reference space `local-floor` (falls back to `local`). The render loop is `renderer.setAnimationLoop`, which uses the session's rAF in XR. OK.
- Placement: no hit-test reticle. The clay sits on a fixed virtual table (y 0.79 m) until an XR plane arrives; Android Chrome usually reports no planes, so the table floats at a fixed spot.
- Menu: the palm-up wrist menu needs hands, so it is unreachable on a phone.
- Pixel ratio: `renderer.setPixelRatio(devicePixelRatio)` uncapped (about 2.6-3.5 on phones) for the non-AR view; in AR the framebuffer uses the XR default scale.
- Needs the phone: `isSessionSupported('immersive-ar')`, Chrome version, fps, console errors -> `/xr-check.html` measures these.
- **Phone results** (`/xr-check.html`, Android 10, Chrome 154): `immersive-ar` supported; granted `local-floor`, `hit-test`, `plane-detection`, `dom-overlay`, `anchors`; no hands. Taps arrive as XR `select` events with `targetRayMode: 'screen'`, and DOM-overlay pointer events also arrive. Hit-test finds surfaces (table at y 0.78 m). About **30 fps** (the AR camera rate on this phone), framebuffer 1080x2408, devicePixelRatio 3.
- **Fix (Step 0):** the input hub listens for `screen` touches on the XR session and feeds their ray to the pointer provider: one finger on the clay sculpts with the current tool, one finger beside it turns the clay. Quest hands and the desktop mouse are unchanged. Still open for Steps 1 and 4: menus in AR (dom-overlay), tap-to-place on a surface, two-finger scale/rotate, pixel-ratio cap.

## Menu, Library and export update (2026-10-13, branch update-menu-library-export)
- Verified in a desktop browser: hide/show button (remembered), Delete with two-press confirm and 5-second Undo (object and clay), Add to Library (exactly one item; cancel adds none), Use / Edit (changes saved back) / Rename / Delete with Undo, reload keeps the Library and the pinned creations, GLB and `.claymind.json` download, Import (drag and drop; wrong files refused).
- GLB checked by the Khronos glTF validator (0 errors, 0 warnings) and re-loaded with three.js's GLTFLoader: right piece count, size within 1 mm, colours and paint as made. **Not yet opened in Blender, Unity, Unreal or Godot by hand.**
- **Not verified on a Quest:** the one-handed menu's Hide / Tools button, Delete and Library pokes in the headset. In the headset, Download, Import and Rename say to use the browser view (no file dialog or keyboard there); Add to Library uses the default name.
- Vertex colours: engines that ignore `COLOR_0` by default (e.g. Unity's standard shader) show painted pieces white; unpainted pieces carry their colour in the material and look right everywhere.
- The Library no longer adds sample items on first run. Items saved automatically by older versions stay in the Library until deleted. Pinned creations from older versions are not put back automatically (pin them again).
- Phone AR: untouched in this update (its diagnosis and touch fix came with pull request #1, above).

## Update 2, Step 0: XR environment and emulated hands (2026-10-15, branch update-2-playkit)
- Nothing XR-related had been removed from git history: the IWSDK emulator (IWER), its `living_room` room and the scene's `IBLGradient` were only ever injected by the dev server. The live site therefore had no emulator.
- Now `iwsdk.config.json` sets `dev.emulator.injectOnBuild: true` and `activation: "always"`: the deployed build carries the emulator (about 1.1 MB, room mesh bundled, no CDN request). It is skipped when the browser reports `OculusBrowser|Quest|Pico|Wolvic|Android|iPhone|iPad|Mobile`, so headsets and phones keep their real WebXR. A desktop PC with a real PC-VR headset in desktop Chrome would still get the emulator.
- Hands tested in the emulator (programmatic IWER hands, seated head at 1.15 m): pinch-pull, Add, Carve, Smooth, Paint, palm-up menu pokes (8/8 in a row), Undo/Redo, Material ring, colour picker, Bring to life, pinch-grab and drop, distance grab, Pin, Add to Library, Library Use/Download, Remove from scene + Undo, Delete + Undo, one-handed menu Hide/Tools, two-hand scale. **Emulated hands are not a real Quest**: pinch reliability, reach, fatigue and tracking loss need the headset.
- Fixed: two-hand scale/turn never started when objects stood on the table (each pinch became a distance grab); the wrist menu grew to 8 rows (35 cm, down past the table), now 5 x 5 (22 x 18 cm); floating cards covered menu buttons; the tutorial card kept the desktop wording in XR.
- Not present: a physics on/off switch (Update 2 Step 1 adds Edit / Play).
- Frame time in the emulator (desktop browser pane, 19 objects incl. Play Kit, 91k triangles, 178 draw calls): about 54 fps, median 16.7 ms (60 Hz display), p95 43 ms. Not a Quest number.

## Update 2, Step 1: Play Kit (2026-10-15)
- Verified offline in the browser and the XR emulator: Add to Play Kit (3 creations, roles guessed: piece, piece, obstacle), Place, Save Set, End, reopen the Set, Edit / Play, Pause (pieces hang until Resume), Reset (all pieces back within 0.3 mm; a missing piece is rebuilt), kit download and import (3 toys and 1 Set back as new copies), all five games set up with every piece resting on the table, Knock-down won with mouse throws (6/6) and played with emulated hand throws (2 blocks down), Flick-and-pocket with fingertip flicks (turns alternate) and a pocketed coin scoring and going to the tray. No request left localhost.
- Fixed on the way: balls thrown hard fell through the 3-4 cm table colliders (no continuous collision detection): table colliders are now 25 cm deep under the top; the play area is centred on the table's usable depth and every layout fits a 50 cm deep table; mouse drags of Play Kit pieces slide over the table so they can be thrown; toys much bigger than a role's slot, or the wrong shape (a ball as a stacking block), are not suggested for it.
- Emulated hands move slowly in the browser pane (about 30 fps): throws and flicks there are weaker than real ones. Throw strength, flick feel and reach must be checked on a Quest.
- A held object trails the hand slightly, so a throw leaves at a little less than hand speed.
- Pause stops all physics (also any creation on the table); holding a piece during a pause moves it without physics until Resume.
- Kit files carry each toy's breakage pieces: about 2 MB per toy (limit 50 MB).
- Rename in the headset is not available (no keyboard): names default to "Toy N" / "Set N"; rename in a browser.

## Update 2, Step 2: agent backend (2026-10-15)
- Verified live with Groq: "carrom" with unknown rules went Wikipedia (2 pages) -> Researcher -> Designer -> Referee in 12.7 s and became Flick-and-pocket with an honest list of what cannot be done and what the kit lacks; three sets of player rules (bowling, cups, marble run) were applied in 2-4 s each; the Coach wrote a 9-step mug guide. A real 429 (tokens per minute) fell through to the next model without an error.
- **Free models cannot write a whole Game Spec reliably** (two live attempts broke basic fields). The Designer therefore adapts a built-in template (players, turns, pieces, win target, time) by default; full specs are the exception and must pass the Referee, else the closest built-in game is used and the player is told.
- Free-tier budgets are small (about 8000 tokens per minute per model): a web lookup plus a design uses most of a minute's budget; busy minutes fall through to slower or smaller models.
- The Referee checks rules and reachability on the server; the physics dry run of a new game is not done yet (it needs the client's physics: Step 3b).
- Web: Wikipedia only (no other search source was needed or verified); pages flagged by the prompt-guard model are dropped. Some games have no Wikipedia page: the Helper then offers the closest built-in game.
- First start downloads the 65 MB embedding model; without it the passage index falls back to keyword search.
- The backend is not deployed publicly yet; the public game does not call it. The Groq key pasted in chat on 2026-10-15 should be rotated after the competition.

## Update 2, Step 3: agent features in the game (2026-10-16)
- Verified in the browser with the live backend: Make a game -> Carrom (web: Wikipedia, 17 s) gave "Mini Carrom" with how to play, uses, missing / not possible and sources; Adjust lowered the win target 10 -> 5 and the game started with the HUD showing 0 / 5; the same request again came from the cache in 0.5 s. Teach me to build a cup: 8 steps in 6 s; Check my work on the 11 cm clay said "the step wants about 8.0 cm, take off about 3.0 cm". Help during a finished Knock-down offered "Reset the game", which reset the table. Offline: "AI helper is offline, built-in games still work." and a built-in game still started.
- Pinch keypad: the XR flow (keypad opens, typed "Jenga", Done sends it, the backend answered Tower balance) was checked by calling the keypad's buttons; poking them with emulated fingertips could not run because the browser pane was hidden (no frames). Re-test the keypad by hand in the emulator and on a Quest.
- A web lookup can read an unhelpful second page (for Carrom: "List of sports"); it is listed as a source because it was read.
- The status line says "Choosing a game..." for typed names until the answer arrives; the preview then says which path really ran.
- The public game (GitHub Pages) has no backend: Ask AI shows offline there until the backend is hosted and `?agents=` points to it.

## Update 2, Step 3b: Simulate it for me (2026-10-15)
- Verified in the browser: a full Knock-down demo (3 throws, 4 down, live scoreboard); Flick-and-pocket (10 flicks, turns alternate; in the headset run a whole game ended inside 20 s); Will it work? passes a straight tower and fails a leaning one, the proposed fix ("Line the pieces up") passes the re-test and Undo restores the lean; What-if with light foam balls offered steel (4 down instead of 0), Apply worked, every replay was identical. All with no network.
- The visible demo stops at 20 s by design: a long game (e.g. 8 turns of Flick-and-pocket with slow coins) can be cut short there; the headless runs play to the end (60 s cap).
- The demo player is simple code, not an expert: it aims at the easiest pocket or the middle of what still stands, with a little seeded randomness; it never tries trick shots.
- What-if varies one thing (material = mass, or the built-in ramp's angle) in steps; it does not change sizes of the player's own toys.
- Will it work? judges "stays where it is for 3 s" (moved more than 1.5 cm or tipped more than 15 degrees fails). The suggested fixes are lining a stack up or a heavier bottom piece, each proven in simulation; other problems get "no simple fix found".
- Slow motion slows the whole physics clock (also anything else on the table) while the demo runs.

## Update 2, Step 4: the helper character (2026-10-15)
- Built from the clay mesher at start-up (about 5k triangles); no external 3D assets. If it cannot be built the bubble works alone.
- Voice output uses the browser's built-in speech synthesis (voices differ by device; off by default). No voice input by design.
- It sits on the table's left (right for left-handed players), clear of the play area; on a very small real table it is clamped onto the table's edge.

## Update 2, Step 5: XR emulator run (2026-10-15)
- Full results and the awkward-hands list: `docs/STEP5_XR_TEST.md`. Fixed from it: throws lost half their speed (hand smoothing beta, release velocity), HUD buttons too small and too far for seated play, and four Researcher problems (wrong pages, over-long answers thrown away, Qwen's output limit, the "busy" message).
- The new hand smoothing (beta 4) must be checked on a Quest for jitter on a still hand while sculpting.

## Update 2 in short: what to expect
- **Free LLMs are not fully reliable.** Free-tier budgets are small (about 8000 tokens per minute per model, Qwen 1000 output tokens per minute); a busy minute makes requests slower or ends in the closest built-in game, and the player is told which. Full Game Specs written by a model often fail the Referee, so most games are a built-in template plus changes.
- **Web search** is Wikipedia only: the game's own page first (when it is about a game), then search hits. Games without a page get the closest built-in game. Text from the web is screened for prompt injection and summarised, never followed.
- **Cold starts:** the backend's first start downloads a 65 MB embedding model; the first web lookup for a game takes 10-17 s, later ones come from the cache in under a second.
- **Emulator vs real Quest:** every hand result in this update comes from the IWER emulator with perfect emulated hands; pinch reliability, throw feel, reach, fatigue and frame rate on a Quest are still to be measured (list in `docs/STEP5_XR_TEST.md`).
- **No voice input**, by design: typing is the browser text box or the pinch keypad; the helper's voice output is optional.


## Update 3 (focus, environment, multiplayer), 2026-10-16
- **Removed on purpose:** the Helper, the Coach, the helper character, "Will it work?" and What-if, the brain graph / Debug the Brain / Mastery and the old AI layer (archived in `_archive/`). The game agent team stays; "Show me how" stays as an optional preview on game cards.
- **Free LLMs are not fully reliable.** Free-tier budgets are small (about 8000 tokens per minute per model, Qwen 1000 output tokens per minute). A busy minute ends in the closest built-in game, and the player is told which. Measured accuracy: `docs/EVAL_REPORT.md`.
- **Environment:** the room's planes (walls, floor, ceiling, furniture tops) become colliders in the XR environment; real-room mesh collision on a phone or in passthrough is not done (phone AR is paused). Fast objects are stopped by thick colliders (no continuous collision detection in the IWSDK physics).
- **Multiplayer:**
  - Edits are applied when they come back from the room, so your own stroke shows after one round trip (about 0.1 s on a good connection, 0.56 s at 250 ms each way).
  - Bring to life in a room (V5): the object appears for everyone; a hold is sent about 15 times a second, a throw runs in each table's own physics and the thrower's resting pose re-aligns the others, so between the throw and the rest the tables can differ by a few centimetres. Objects made before joining a room stay on their own table.
  - Host leaves: the room carries on with a new host, but the game in progress ends (no physics hand-over).
  - The relay keeps rooms in memory: a restarted server ends every room.
  - Presence is head and two hands (no finger joints); a wave or a thumbs-up held for half a second shows on the name tag (thumbs-up detection tuned on emulated hands only).
  - Turning or resizing the shared clay with two hands is your own view only.
  - Tested with two browser tabs, scripted players and simulated latency / loss, not with two headsets.
- **Emulator vs Quest:** every hand result comes from the IWER emulator with perfect emulated hands; pinch reliability, throw feel, reach, fatigue and frame rate must be measured on a Quest (list in `docs/QA_REPORT.md`).
- **No voice** by design: no microphone and no voice chat anywhere; typing is the browser text box or the pinch keypad.
