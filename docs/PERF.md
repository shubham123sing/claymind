# Performance log

Budget: 72 fps on Quest 3 (13.9 ms/frame), sculpt update ≤ 4 ms/frame on the main thread, ≤ 500k visible triangles.

## Phase 0 (2026-10-09)

| Measurement | Device | Result |
|---|---|---|
| SDF 48³ init (fill + full mesh) | Desktop, Node 24 | 33 ms, 9.5k tris |
| SDF 48³ per stroke (brush + remesh, worker) | Desktop | p50 2.4 ms, p95 3.7 ms, 27 chunks re-meshed |
| SDF 64³ per stroke | Desktop | p50 2.9 ms, p95 4.5 ms, 17.2k tris |
| Main scene draw calls / tris | Desktop browser | 8 calls, 1.3k tris |
| Main scene frame time | Quest 3 | _pending device run_ |
| SDF page benchmark | Quest 3 Browser | _pending device run_ |
| MediaPipe hands fps / inference | Webcam laptop | _pending_ |

Notes:
- Each stroke re-meshes 3×3×3 chunks because brush reach = radius + 4-voxel band. Phase 1: mark only changed samples' chunks and shrink the band to cut that to about 8.
- Command: `npx vite-node tests/bench/sdf-bench.ts [res]`.

## Phase 1 (2026-10-09)

| Measurement | Device | Result |
|---|---|---|
| Per stroke, 48³ (brush + remesh incl. drag) | Desktop, Node | p50 1.0 ms, p95 2.7 ms, ~8-12 chunks |
| 5-minute soak, 72 strokes/s, random undo/redo (`tests/bench/sculpt-soak.ts`) | Desktop, Node | p95 2.3-2.8 ms every minute, no drift; worst undo 48 ms (checkpoint every 8 actions) |
| In-app worker time / round trip (emulated XR pinch-pull) | Desktop browser | p50 0.7 ms, p90 1.7 ms, round trip 2.7 ms |
| Draw calls while sculpting | Desktop browser | 30-96 (one per non-empty chunk + UI) |
| Quest 3: 5 min sculpting at ≥ 60 fps | Quest 3 | _pending your device run_ |

Notes:
- Dirty marking now uses only the samples that actually changed, plus one sample for normals: 27 → 8-12 chunks per stroke.
- Chunk meshes are separate draw calls (about 40-60 for a typical sculpt). If Quest is draw-call bound, merge idle chunks (IDEAS.md).

## Phase 2 (2026-10-09)

| Measurement | Device | Result |
|---|---|---|
| Bake (describe + match + fit + 56³ mesh + 6 fracture pieces) | Desktop browser worker | 76-192 ms |
| Template library descriptors (10 templates, once) | Desktop | computed in the worker in the background while sculpting |
| Dynamic bodies | - | ≤ 4 creations + ≤ 24 pieces (pieces live 7 s) |
| Draw calls per creation | - | 3 (mesh, shadow, label); shards: one instanced mesh for all |
| Quest 3: bake time, physics with 4 objects + pieces | Quest 3 | _pending device run_ |
