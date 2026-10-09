# Architecture (as built, Phase 1)

```
client/src
  index.ts                    World.create + system registration (?spikes = Phase 0 probes)
  core/event-bus.ts           typed event bus shared by systems
  platform/
    input/hand-state.ts       InputProvider port + HandState (what every tool reads)
    input/xr-hands-provider.ts  tier A: WebXR joints -> pinch / point / open palm / palm normal, 1€ smoothing, glitch guard
    input/pointer-provider.ts   browser: mouse/touch -> right-hand HandState (+ orbit)
    input/pinch-detector.ts, one-euro.ts   pure helpers (unit-tested)
    surface/surface-system.ts SurfaceProvider: virtual table or nearest real table plane (within seated reach); static colliders
  sculpt/
    sdf-grid.ts               SDF field + brushes (add/carve capsules, smooth, drag), precise dirty-chunk marking, resample
    marching-cubes.ts         chunked mesher (8³ cells/chunk), normals from SDF gradient, mesh volume
    sculpt-engine.ts          grid + mesher + undo/redo (stroke history + checkpoints) + AABB/volume
    sdf-worker.ts             worker wrapper around SculptEngine
    sculpt-client.ts          main-thread side: coalescing, one request in flight, timing stats, auto resolution downgrade
    tools.ts                  SculptTool registry (Shape, Add, Carve, Smooth) + shared palm-smooth gesture
    clay-view.ts              chunk meshes, contact shadow, size ring/label, brush cursors
    sculpt-system.ts          orchestrates input -> tools -> worker -> view; two-hand rotate/scale; keys; HUD
  ui/wrist-menu.ts            palm-up menu, poke-to-press (XR)
  ui/toolbar.ts               same menu items as HTML (browser)
  audio/sculpt-audio.ts       procedural squish + UI ticks (WebAudio, spatialised)
  devtools/hud.ts             debug HUD (DOM + world panel), `?debug` or H
  spikes/                     Phase 0 probes (`?spikes`), SDF bench page, MediaPipe page
```

**Data flow per frame:** InputProviders fill `HandState`s → the wrist menu takes the off hand when the palm is up → two-hand rotate/scale when both hands pinch away from the clay → the active `SculptTool` turns each hand into world-space strokes → `SculptSystem` converts them to grid-local (inverse clay transform, mirror) → `SculptClient` coalesces them and sends them to the worker → the worker applies them, re-meshes dirty chunks and returns geometry + AABB + volume → `ClayView` swaps the chunk geometries and updates the size readout.

**Coordinates:** the clay grid is a 25 cm cube centred on `ClayView.root`. Strokes are in grid-local metres, so the clay can be rotated and scaled freely. History replays strokes, so it is independent of the grid resolution.
