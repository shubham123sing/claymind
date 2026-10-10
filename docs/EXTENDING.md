# Extending ClayMind

Each recipe below is kept true as the code changes. The recipe for challenges will be added in the phase that introduces it.

## New material (data only)
Add one entry to `client/src/materials/materials.json`:
- `density` (kg/m³), `friction`, `restitution`
- `fragility` (`null`, or `{ breakSpeed: m/s impact Δv, pieces }`) and `hardness` (0..1, ≥ 0.7 throws chips on hard hits)
- `sound`: `partials` (frequency ratios), `base` Hz, `decay` s, `noise` 0..1, `gain`
- `visual` (`color`, `roughness`, `metalness`, `opacity`) and `tags`

Nothing else changes: mass, physics, impact sound, breaking and the Material cycle pick it up. Optionally add it to template `materialPriors` or to a `shapePriors` rule (same file) so the estimator can guess it.

## New template object (data only)
Drop a JSON file in `client/src/objects/templates/`: `{ schemaVersion, id, name, category, materialPriors, tags, sdf }`.
`sdf` is a small CSG tree in metres with the base at y = 0 (see `client/src/objects/csg.ts`):
- primitives: `sphere`, `ellipsoid`, `box` (+`round`), `cylinder` (+`round`), `cone`, `torus`
- operations: `union` / `intersect` (`children`, smooth `k`) and `subtract` (`a` minus `b`)
- per-node `at` (translate) and `rot` (degrees)

The matcher, baker and fracture pick it up automatically. Run `npx vite-node tests/bench/descriptors.ts` to see its descriptor; `tests/unit/matcher.test.ts` checks that every template matches itself when sculpted. Templates are matched by shape only (scale and yaw invariant). `TEMPLATE_THRESHOLD` in `sculpt-system.ts` (0.7) decides when a template replaces the sculpt.

## New sculpt tool / brush
1. In `client/src/sculpt/tools.ts`, create an object implementing `SculptTool`: `id`, `label`, `icon`, `color`, `cursorRadius`, and `update(hand, ctx, state)`.
2. Inside `update`, read the `HandState` (`pinching`, `pointing`, `palmOpen`, `aimPoint`, `indexTip` …). Call `ctx.beginAction()` when a gesture starts (one undo step) and `ctx.stroke(op, worldPoint, worldRadius, worldDelta?)` while it runs. The helpers `stamp()` and `applyCommonGestures()` cover spacing, capsules and palm smoothing.
3. Append it to `TOOLS`. The wrist menu, browser toolbar and number-key shortcuts pick it up automatically.
4. A new brush *operation* (not just a new gesture mapping) goes in `SdfGrid.brush` (`client/src/sculpt/sdf-grid.ts`), plus a unit test in `tests/unit/sculpt-engine.test.ts`.

## New input device
1. Implement `InputProvider` (`client/src/platform/input/hand-state.ts`): `active()` and `update(hands, dt)`, which fills the left/right `HandState` in world metres.
2. Register it in `SculptSystem.init` (`this.providers`). The first active provider each frame drives the hands.
3. Reuse `PinchDetector` and `OneEuroFilter3` so behaviour matches the other devices. The MediaPipe webcam adapter (tier C, Phase 7) follows this path.

## Work surface
`SurfaceSystem` (`client/src/platform/surface/surface-system.ts`) publishes the `surface` object (`topY`, centre, half extents, yaw, `real`, `version`). Systems that place things on the table watch `surface.version`.

## Tuning knobs
| What | Where |
|---|---|
| Grid resolution (default 48) | `?res=64` URL param; `RES_STEPS`/`DOWNGRADE_MS` in `sculpt-client.ts` |
| Pinch thresholds | `DEFAULT_PINCH` in `pinch-detector.ts` |
| Smoothing | `OneEuroFilter3` params in `xr-hands-provider.ts` |
| Brush radii | each tool in `tools.ts` |
| Usable table distance | `MAX_TABLE_DISTANCE` in `surface-system.ts` |

## New knowledge (data only)
Edit `client/src/kg/seed/knowledge.json`:
- add a property, behaviour or feature to `properties` / `behaviors` / `features` (`key: label`)
- add a belief to `edges`: `[from, relation, to, confidence, domain]`, e.g. `["prop:sticky", "causes", "beh:stays_put", 0.8, "adhesion"]`
- `tagMap` turns template `tags` into Concept edges

Material properties are generated from `materials.json` in `kg/seed.ts`. New seed knowledge reaches existing players only after "Reset brain", because their saved brain is kept.

## New KG rule (data only)
Add an object to `client/src/kg/rules/core.json` (or a new file listed in `kg/brain.ts`):
`{ "id", "label", "if": [{ "s": "?x", "r": "<relation>", "o": "?y" }, …], "then": { "s", "r", "o" }, "factor": 0..1 }`.
Variables start with `?`. Add a golden test in `tests/unit/kg.test.ts` that checks the reasoning path.
See `docs/KG_SCHEMA.md` for relations.

## New AI provider
**Server (real services):**
1. Implement one of the protocols in `server/app/providers/base.py`: `VlmProvider.describe`, `ImageProvider.refine`, or `ModelProvider.submit/poll`. Each needs a `name` and a `version` (used in cache keys). Raise `ProviderError` on any failure.
2. Register it in `server/app/providers/__init__.py` under a new env value (e.g. `MODEL_PROVIDER=sam3d`), and add its settings to `config.py` and `.env.example`.
3. Validate its output into the schemas in `server/app/schemas.py`. Add a test with a stubbed client (see `tests/test_anthropic_vlm.py`).

**Client (in-browser):** implement `AiProvider` (`client/src/ai/types.ts`) and select it in `AiSystem.chooseProvider`. `LocalMockProvider` is the reference implementation.

Game logic never names a vendor or model: it only sees `AiProvider` results, which are validated (`validateDescribe`) and treated as suggestions.
