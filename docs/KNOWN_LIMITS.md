# Known limits and spike results

Last updated: 2026-10-09 (Phase 0). Stack: `@iwsdk/core` 1.0.1, super-three 0.181, `@mediapipe/tasks-vision` 1.1.0.

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
