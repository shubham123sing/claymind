# Architecture (as built, Phase 2)

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
  platform/input/input-system.ts  input hub: providers -> shared hands + per-hand claims (object / menu)
  materials/materials.json    12 materials (physics, fragility, sound, look) + shape-prior rules
  materials/materials.ts      typed access + estimator (combines prior tables)
  objects/csg.ts              SDF CSG language for templates
  objects/templates/*.json    template library (auto-loaded)
  objects/descriptor.ts       shape descriptor (aspect, elong, fill, profile, open top, holes)
  objects/matcher.ts          weighted descriptor distance -> similarity
  objects/bake.ts             mesh + volume + Voronoi fracture pieces; template fitting to the sculpt
  objects/object-system.ts    spawn / materialize / hold (palm, pinch, mouse) / throw / break / recall / labels
  objects/creation.ts         Creation data model (schemaVersion)
  physics/impact-system.ts    impacts from velocity deltas (no engine contact events)
  audio/impact-audio.ts       modal impact synthesis per material
  fx/shards.ts                instanced debris
  ui/wrist-menu.ts            palm-up menu, poke-to-press (XR)
  ui/toolbar.ts               same menu items as HTML (browser)
  audio/sculpt-audio.ts       procedural squish + UI ticks (WebAudio, spatialised)
  devtools/hud.ts             debug HUD (DOM + world panel), `?debug` or H
  spikes/                     Phase 0 probes (`?spikes`), SDF bench page, MediaPipe page
```

**Data flow per frame:** InputProviders fill `HandState`s → the wrist menu takes the off hand when the palm is up → two-hand rotate/scale when both hands pinch away from the clay → the active `SculptTool` turns each hand into world-space strokes → `SculptSystem` converts them to grid-local (inverse clay transform, mirror) → `SculptClient` coalesces them and sends them to the worker → the worker applies them, re-meshes dirty chunks and returns geometry + AABB + volume → `ClayView` swaps the chunk geometries and updates the size readout.

**Coordinates:** the clay grid is a 25 cm cube centred on `ClayView.root`. Strokes are in grid-local metres, so the clay can be rotated and scaled freely. History replays strokes, so it is independent of the grid resolution.

**Bring to life:** `SculptSystem.bringToLife()` → worker `bake` (describe the sculpt; rank templates; if the best is ≥ 0.7, fit that template to the sculpt's footprint, size and orientation, else keep the sculpt; mesh; fracture into 6 pieces) → material estimate (template priors + shape rules) → `creation:baked` event → `ObjectSystem` spawns it (materialize → fly to the hand in XR / hover beside the clay in the browser) → the clay resets to a fresh lump (undoable).

**Physics loop:** held objects are teleported with gravity off; on release they get the hand's velocity. `ImpactSystem` turns velocity jumps into `physics:impact` events → impact sound; above the material's `breakSpeed` the object is swapped for its pre-baked pieces plus shards.
