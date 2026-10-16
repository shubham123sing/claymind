# Update 3, Step A.1: audit (2026-10-16)

Core (from `CLAYMIND_UPDATE_3`): make clay by hand -> material and colour per piece, painting ->
physics -> Library (opt-in, GLB export) -> Play Kit (items, Sets, games, the game agent) ->
multiplayer -> environment interaction. Phone AR code is kept untouched (paused, not deleted).

Branch `update-3-focus-multiplayer` starts from `update-2-playkit` (Update 2 is not merged into
master yet and Update 3 builds on its Play Kit).

## Client (`client/src`)

| Area | Files | Verdict | Why |
|---|---|---|---|
| Sculpting (SDF grid, mesher, worker, tools, clay view) | `sculpt/*` | KEEP | core: make |
| Template matching after Bring to life | `objects/matcher.ts`, `objects/templates.ts`, `objects/templates/`, `objects/csg.ts` (used by bake), `sdf-worker.ts` matcher call | UNSURE | only used by the old AI path (`devAi`); interwoven with the bake worker, so kept for now and listed |
| Objects, bake, colliders, thumbnails, env map | `objects/object-system.ts`, `object-view.ts`, `bake.ts`, `collider.ts`, `creation.ts`, `descriptor.ts`, `env-map.ts`, `thumbnail.ts`, `object-components.ts`, `throw.ts` | KEEP | core: physics, material |
| First-run sample creations | `objects/samples.ts` (no importer), `settings.samplesAdded` | REMOVE | dead code |
| Old GLB writer for AI samples | `objects/glb.ts` (no importer) | REMOVE | dead code (export uses `export/glb.ts`) |
| Materials, matchups | `materials/*` | KEEP | core |
| Physics runtime ext, body build, impacts, properties | `physics/*` | KEEP | core |
| Breakage shards | `fx/shards.ts` | KEEP | physics |
| Input hub, hands, pointer, surface | `platform/*` | KEEP | core (also phone AR input: untouched) |
| Library, GLB export, project file, IndexedDB | `storage/library.ts`, `storage/idb.ts`, `export/*`, `ui/library.ts`, `ui/download-dialog.ts` | KEEP | core |
| Brain graph storage | `storage/kg-repo.ts` | REMOVE | only used by the brain |
| Play Kit (kit, Sets, rule engine, templates, panels) | `playkit/*` except below | KEEP | core |
| Demo player ("Show me how") | `playkit/demo-player.ts`, `sim/planner.ts`, `sim/headless-sim.ts` | KEEP, smaller | spec: only as a small optional preview inside the game-preview card; first to cut |
| Will it work?, What-if | `sim/runs.ts` (stability, suggestFix, whatIf), `sim/sim-worker.ts`, `sim/sim-client.ts`, HUD second row in `playkit-panels.ts` / `playkit-system.ts` | REMOVE | spec: remove |
| Ask AI panel: Make a game | `helper/helper-panel.ts` (games, preview, adjust views), `helper/helper-client.ts` (`game`), `helper/adjust.ts`, `helper/keypad.ts` | KEEP, moved | the game agent's UI; it moves into Play Kit (no "Ask AI" menu item) |
| Ask AI panel: Teach me to build, Check my work, Help / I'm stuck | `helper/helper-system.ts` (teach, check, help, doFix), `helper-panel.ts` (home, guide, help views), `helper-client.ts` (`ask`, `guide`, `check`) | REMOVE | spec: the Helper and the Coach go |
| Clay-blob helper character and bubble | `helper/mascot.ts`, settings `helper` / `helperVoice`, bus `mascot:*` | REMOVE | spec |
| First-run tutorial card | `ui/coach.ts` (`CoachSystem`) | KEEP (rename to `tutorial.ts`) | it is the onboarding card, not the AI Coach; renamed so nothing is confused |
| Brain graph, Debug the Brain, experiments, Mastery | `kg/*`, `kgview/*`, `agent/*`, `game/*` (`KGSystem` and `ExperimentSystem` are registered for every player) | REMOVE | not core; hidden behind `?devKgView` since plan v4 but still loaded and running |
| Old AI layer (vision naming, image-to-3D, mock provider) | `ai/*`, `?devAi`, `core/flags.ts`, bus `creation:described / creation:model / creation:ai-status`, AI menu item | REMOVE | spec: unused AI code from earlier versions (off since plan v4) |
| Phase 0 spikes | `spikes/*`, `client/spikes/*.html`, `?spikes`, `SpikeBody` in `components.ts`, Vite `SPIKES` inputs | REMOVE (to `_archive/`) | old experiments |
| `@mediapipe/tasks-vision` | `package.json` | REMOVE | only the hands spike used it |
| Debug HUD | `devtools/hud.ts` (`?debug` only, never in the menu) | KEEP (dev only) | needed for perf numbers in QA; not in the user menu |
| Settings panel, toolbar, wrist menu, canvas panels, undo toast, colour / material pickers, scene actions, delete creation | `ui/*` | KEEP | core |
| UI sounds, impact and sculpt audio | `audio/*` | KEEP | core feel |
| UIKit welcome card | `public/ui/welcome.uikitml`, `panel.ts` | KEEP | onboarding |
| Phone AR diagnostic page | `public/xr-check.html` | KEEP | AR code: untouched |
| Sample GLBs | `public/samples/*.glb` (only the AI layer loads them) | REMOVE | dead with the AI layer |
| WebXR banner / texture | `public/gltf/webxr-banner`, `public/textures/webxr.png` | UNSURE | scaffold assets; checked for references before removal |

## Server (`server/`)

| Area | Files | Verdict | Why |
|---|---|---|---|
| Game agent team: Kit Analyst, Researcher, Game Designer, Referee | `agents/analyst.py`, `web.py`, `referee.py`, `flows.make_game`, `research` | KEEP | spec: keeps Play Kit agentic |
| Kit Analyst vision check | not present (geometry only) | GAP | the spec lists "geometry + vision"; noted, not added in Step A |
| Helper (home agent) and Coach | `team.py` helper / coach agents, `flows.helper`, `coach_guide`, `coach_check`, `/v1/helper`, `/v1/coach/*`, their schemas | REMOVE | spec |
| Knowledge (kit graph, passages, memory), governor, cache, trace, A2A | `agents/knowledge.py`, `governor.py`, `governed_model.py`, `store.py` | KEEP | used by the game agent |
| Old Phase 4 AI proxy | `server/app/*`, `server/requirements.txt`, `server/samples/*`, `tests/test_anthropic_vlm.py` and other `server/tests` for it | REMOVE (to `_archive/`) | unused since plan v4 |

## Docs
`docs/KG_SCHEMA.md` and the brain / Mastery / AI layer sections of README go with the code;
`docs/IDEAS.md`, `PLAN.md`, `UPDATE_1/2.md` stay as history.

## Menu now (wrist menu / toolbar, 24 items)
Shape tools (Shape, Add, Carve, Smooth, Paint, Eraser), Bring to life, Mirror, Undo, Redo, New piece,
Material, Color, Join, Separate, Pin / Unpin, Play Kit, Add to Play Kit, **Ask AI**, Library,
Add to Library, Settings, Remove from scene, Clear scene, Delete this creation, New clay
(+ Brain, Check beliefs, Mastery with `?devKgView`; AI with `?devAi`).

## Menu after cleanup (Step A.4)
Two levels in the wrist menu (palm up; 3 x 3 categories, about 13 cm square) and the browser
toolbar; a category opens its actions with **Back** first. Hide / show: the one-handed menu's
Hide button, the browser's round button, or lowering the palm.

- **Make**: Shape, Add, Carve, Smooth, Mirror, New piece, Join, Separate, Undo, Redo, New clay, Delete this creation
- **Material & Colour**: Material, Color, Undo
- **Paint**: Paint, Eraser, Color, Undo
- **Physics**: Bring to life, Undo
- **Place & Pin**: Pin / Unpin, Remove from scene, Clear scene
- **Library**: Open Library, Add to Library
- **Play Kit**: Open Play Kit, Add to Play Kit (the game agent is inside: Games -> "Make a game with AI")
- **Multiplayer**: Room (disabled until Step C)
- **Settings**

## What was removed (Step A.2-A.3, one commit each)
| Commit | What |
|---|---|
| Remove the clay-blob helper character | `helper/mascot.ts`, its settings and events |
| Remove "Will it work?" and What-if | `src/sim/*` (runner moved to tests), HUD row; demo play kept as "Show me how" on the game cards |
| Remove the Helper and the Coach (client) | Teach me to build, Check my work, Help / I'm stuck, the Ask AI menu item; the game agent panel moved to `src/game-agent/` |
| Server: remove the Helper and Coach agents | `/v1/helper`, `/v1/coach/*`; the unsafe-request filter moved into make-a-game |
| Archive the brain graph, Debug the Brain, Mastery, old AI layer | `src/kg`, `kgview`, `agent`, `game`, `ai`, `core/flags.ts`, `storage/kg-repo.ts` -> `_archive/` |
| Archive the Phase 0 spikes; drop MediaPipe, sample GLBs, dead code | `src/spikes`, spike pages, `@mediapipe/tasks-vision`, `public/samples`, `objects/samples.ts`, `objects/glb.ts` |
| Archive the old Phase 4 AI proxy server | `server/app`, `requirements.txt`, `server/samples`, old tests |
| Rename the tutorial card | `ui/coach.ts` -> `ui/tutorial.ts` |

Still UNSURE (kept): template matching in the bake worker (`objects/matcher.ts`, `templates.ts`, `templates/`), the `?debug` HUD, the scaffold WebXR banner assets.
