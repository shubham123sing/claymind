# Architecture (as built, Phase 6b, plan v4)

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
  materials/materials.ts      typed access + estimator (combines prior tables); 8 materials, old ids aliased
  materials/matchups.json/.ts material pair rules: damage, friction, sound mix; feltSpeed() for breaking
  physics/physical-properties.ts  computePhysicalProperties(parts): exact mass, COM, inertia, support/tipping; bodyParameters()
  physics/runtime/physics-runtime-ext.ts  IWSDK's worker runtime + Havok compound shapes + collision events (swapped in by vite.config.ts)
  physics/runtime/compound-format.ts      compound description packed in a hull vertex buffer; contact message type
  objects/collider.ts         per-piece collider: hull, or <= 40 voxel boxes for hollow pieces
  ui/material-picker.ts       ring of 8 materials on the touched piece (poke / click)
  ui/color-picker.ts          hue ring, lightness, swatches, whole-piece colour, paint / eraser, brush size
  ui/library.ts               auto-save to IndexedDB, restore pinned creations, the Library shelf panel
  storage/library.ts          saved-creation format, table-relative poses
  objects/thumbnail.ts        offscreen thumbnail of an object
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
  kg/schema.ts, graph.ts      KG types; store with undoable change log + snapshot (see docs/KG_SCHEMA.md)
  kg/reasoner.ts              forward chaining with provenance -> reasoning paths; contradictions
  kg/rules/core.json          generic rules; kg/seed/knowledge.json: domain beliefs (editable)
  kg/seed.ts, brain.ts        seeding (incl. from materials/templates); Brain facade: predictions, edits, creations
  kg/migrations.ts            snapshot upgrades
  storage/idb.ts, kg-repo.ts  IndexedDB (memory fallback), debounced autosave
  kgview/focus.ts, layout.ts  which subgraph to show; layered layout
  kgview/kg-view.ts           3D nodes/edges/handles, rubber band, path playback
  kgview/brain-card.ts        predictions + "Why?" + Undo / Reset / Overview (poke or click)
  kgview/kg-system.ts         placement, hand & mouse gestures (cut, connect, select), edit diffs
  audio/ui-sounds.ts          tick / snip / chime
  ai/types.ts                 AiProvider port, request/response types, validateDescribe
  ai/http-provider.ts         server client: timeouts, retry/backoff, abort, job polling
  ai/local-mock-provider.ts   in-browser mock (static/offline build) using shipped sample GLBs
  ai/snapshot-renderer.ts     offscreen clay renders (3 angles) for the vision model
  ai/model-normalize.ts       GLB scene -> one centred mesh, volume-matched to the sculpt
  ai/ai-cache.ts              IndexedDB cache keyed by quantised shape (repeat shapes are instant)
  ai/ai-system.ts             orchestration: cache -> describe -> material/KG -> refine -> generate -> swap
  agent/agent.ts              Debug the Brain: planTests (from predictions + paths), Agent.checkBeliefs / askMaterial, memory; pure, unit-tested
  agent/experiment-system.ts  visible physics experiments on a clear table spot (drop-compare, drop-break, bounce) -> measurements
  agent/agent-system.ts       wires agent + panels to the brain anchor, poke/mouse answers, metrics hooks
  agent/agent-panel.ts        step log + answer buttons (+ aria-live DOM mirror)
  game/metrics.ts             Mastery metrics (IndexedDB), score
  game/mastery-panel.ts       Mastery screen
  ui/canvas-panel.ts          shared canvas-texture panel: regions, hover, poke
  objects/glb.ts              minimal GLB writer (+ vertex welding) for samples / caching
server/ (Python, FastAPI)
  app/main.py                 routes: /health, /vlm/describe, /image/refine, /model/generate, /model/jobs, /model/files
  app/providers/              mock, anthropic_vlm (Claude vision, strict JSON), fal (queue API)
  app/cache.py, guards.py     content-hash cache; size limits, per-session quotas, global spend cap
  app/jobs.py                 async image-to-3D jobs with progress
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

**Brain loop:** `creation:baked` → `Brain.addCreation` (is_a concept by shape match, made_of material by estimate, features and heaviness by measurement) → reasoner → predictions + paths → `focusGraph` → `layoutGraph` → `KGView`. User edits (cut / connect / material change via `object:material-set`) go through `Brain` as user-sourced, undoable changes. The card shows the before → after effect on the predictions. Autosave writes the snapshot to IndexedDB.

**AI loop (optional layer):** `creation:baked` (local object already exists) → `AiSystem`: cache hit → apply instantly; otherwise render the sculpt → `describe` → `creation:described` (KG gains `vlm` beliefs: is_a, made_of) + merged material estimate → `creation:set-material` (by `ai`) → for raw sculpts / weak matches: `refine` → `generate` with progress (`creation:ai-status`) → `creation:model` → `ObjectSystem` rebuilds the body with the new geometry. Provider: server if `/health` answers, else the in-browser mock (`?ai=` overrides). Failures keep the local result.
