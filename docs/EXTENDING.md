# Extending ClayMind

Each recipe below is kept true as the code changes. Recipes for AI providers, challenges and KG rules will be added in the phases that introduce them.

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
