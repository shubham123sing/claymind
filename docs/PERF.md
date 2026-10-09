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
