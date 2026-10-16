# V5 Phase 0: audit (2026-10-16)

Branch `v5-playkit-multiplayer`, cut from `update-3-focus-multiplayer` (Update 2 and Update 3 Steps A-C,
part of D). None of this is on `master` yet: the live site still shows the Update 1 build.

## Features

| Area | Status | Where | Notes |
|---|---|---|---|
| Sculpt (pull, add, carve, smooth, mirror, pieces) | DONE | `client/src/sculpt/*` | |
| Undo / redo | DONE | `sculpt-engine.ts`, `ui/undo-toast.ts` | per player in a room |
| Material per piece | DONE | `materials/*`, `ui/material-picker.ts` | ring of 8 materials |
| Colour, paint, eraser | DONE | `ui/color-picker.ts`, `sdf-grid.ts` | |
| Physics (Havok, compound bodies, breaking, impacts) | DONE | `objects/*`, `physics/*`, `fx/shards.ts` | |
| Place / pin, Remove from scene, Clear scene, Delete creation | DONE | `objects/object-system.ts`, `ui/scene-actions.ts`, `ui/delete-creation.ts` | |
| Menu (two levels) with hide / show | DONE | `ui/wrist-menu.ts`, `ui/toolbar.ts` | V5 categories already |
| Library (add, use, edit, rename, download, delete + undo, import) | DONE | `ui/library.ts`, `storage/library.ts` | Download is browser-only (clear message in XR) |
| GLB + `.claymind.json` export / import | DONE | `export/*`, `ui/download-dialog.ts` | glTF validator in tests |
| XR emulator in the build, room environment | DONE | `client/iwsdk.config.json` (`dev.emulator.injectOnBuild`, `activation: always`, phones/headsets excluded) | restored in `58a87c9` (Update 2 Step 0); not on master yet |
| Environment colliders, safety volume | DONE | `platform/surface/surface-system.ts`, `object-system.ts` | room planes; fallback walls; no CCD (thick colliders instead) |
| Play Kit: kit, roles, Sets, Edit / Play, Pause, Reset, games | DONE / PARTIAL | `playkit/*` | missing V5: `hand_held` role flag, `tilt_exceeded`, paths, user-marked zones, assisted flick, held tool colliding with hand speed, Sets with scale / physics settings, Kit + Sets inside `.claymind.json` (kit has its own file) |
| Game agent: Kit Analyst, Researcher, Designer, Referee, KG, memory, A2A, governor | PARTIAL | `server/agents/*`, `client/src/game-agent/*` | missing V5: vision check, Intent Resolver, Point + Say, ~30 built-in Rule Cards, Referee dry-run in the same physics, composing specs from primitives beyond templates |
| Multiplayer: rooms, presence, shared clay, shared games, kit share | DONE / PARTIAL | `client/src/multiplayer/*`, `server/agents/rooms.py` | missing: thumbs-up emote, keep a shared toy in the Library, Point + Say in a room, Bring-to-life objects shared |
| QA / eval | PARTIAL | `docs/QA_REPORT.md` (to write), `eval/playkit` (23 cases, first run 48%) | V5 needs >= 25 agent cases and >= 15 Point + Say cases |
| Deploy pipeline | DONE (stale) | `.github/workflows/pages.yml` (master -> GitHub Pages) | backend not hosted yet |
| AI code | only the game agent | `server/agents`, `client/src/game-agent` | old AI layer, brain graph in `_archive/` |
| Dead code / debug UI | CLEAN | `?debug` HUD only (never in the menu) | template matcher in the bake worker kept (UNSURE) |

Frame rate (desktop XR emulator, typical creation): **60 fps** (display-limited); a Set idle 42 fps; not a Quest number.

## Hand actions in the emulator (emulated hands, this session)

| Action | Works | Problem | Fix |
|---|---|---|---|
| Palm-up menu, categories, Back | yes (all presses) | a test fingertip coming from behind the menu pressed another button | harness approaches from the front (real hands do) |
| Sculpt add / carve / smooth by pinch | yes (+63 / -31.5 cm³ / smoothed) | | |
| Undo / redo from the menu | yes | | |
| Paint stroke by pinch | yes (1 paint event) | | |
| Bring to life (Physics menu) | yes | | |
| Pinch-grab and throw | yes (thrown 1.3 m, landed on furniture) | | |
| Two-hand scale of the clay | yes (3/3, also both pinches in the same frame) | first try failed: the test's left palm was still turned up (menu open blocks that hand) | none needed |
| Material ring by fingertip | yes (stone) | | |
| Colour picker by fingertip, whole piece | yes (#f1da6f) | | |
| Library: open, select, Use by fingertip | yes (a copy placed) | | |
| Library add / pin (earlier in this session) | yes (material and paint kept) | | |
| Download in the headset | by design no | a file cannot be saved from inside an immersive session | message: "Download works in the browser view" |
| Throws keep hand speed | yes (fixed in Update 2 Step 5) | | |
