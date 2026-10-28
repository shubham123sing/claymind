# V6 Stage 0: VR audit (2026-10-28)

What works **inside the headset with hands only**, checked in the IWER emulator with scripted hands
(`qa/e2e`). Nothing here is verified on a real Quest (no headset yet).

Legend: **yes** = in-world UI, done with hands, exercised by a scripted-hands run; **yes (untested)** =
in-world UI exists, not run by the scripts; **no** = needs the browser, keyboard or mouse.

## Entry

| Item | Before Stage 0 | Now |
|---|---|---|
| A clear entry on load | one button, "Start in mixed reality" | **Enter VR** (first) and **Mixed reality (your own table)** on the welcome card |
| VR (opaque) session | not offered | yes: `immersive-vr`, ClayMind's studio room (walls, window light, floor, rug, table legs) |
| Mixed reality | yes (`immersive-ar`) | unchanged; the room is hidden, the real room shows through |
| Hand tracking | requested (optional) | unchanged |
| Desktop toolbar and keyboard hints in XR | hidden in an immersive session | unchanged (hidden) |

The table: in VR the work surface is the virtual table, or a real desk if the headset reports one
within reach (then the room draws its top and legs where the real desk is, so the hands touch what the
eyes see). In mixed reality the virtual table is a translucent hint until a real table is found (as before).

## Every tool by hand

| Feature | Hands only in XR | Evidence |
|---|---|---|
| Wrist menu (left palm up; one-handed: fixed beside the clay) | yes | e2e step a onwards |
| Add, Shape (pull), Carve, Smooth, two-hand scale and turn | yes | e2e a |
| Mirror, New piece | yes | car build script, 2026-10-19 (`qa/e2e/car.js`) |
| Undo / Redo, New clay, Delete this creation | yes (untested) | |
| Colour picker: swatch, hue, lightness, Whole piece | yes | e2e b, car script |
| Paint, Eraser, brush size − / + | yes | e2e b; **brush − was broken** (fixed in this stage) |
| Bring to life | yes | e2e b |
| Material picker on a touched piece | yes | e2e b, car script (4 pieces, 4 materials) |
| Separate / Join | yes | car script (2 objects -> 1, 4 pieces) |
| Grab, carry, drop, throw | yes | e2e c, f |
| Pin / Unpin, Remove from scene, Clear scene | yes | e2e c (Remove) |
| **Recenter** (Place & Pin -> Recenter) | **new**: yes | Stage 0 probe: head turned 50°, clay moved 20 cm toward the gaze (clamped to the table) |
| Library: open, Use, Edit, Delete | yes (untested) | |
| Library / Play Kit / Set **Rename** | was **no** ("needs a keyboard"); **now yes** (pinch keypad) | Stage 0 probe: "Clay 1" -> typed CAR -> "Car" |
| Library and Play Kit Download / Import | **no** (browser view only: the headset has no file picker) | by design; the message says so |
| Play Kit: Add, Place, Role, Duplicate, Share, Remove, Sets | yes | e2e d, e |
| Game agent: cards, "Show me with my hands", chips, pinch keypad, Make it | yes | e2e e |
| Playing: HUD Play / Edit / Pause / Reset / Rules / Save Set / End | yes | e2e f |
| Multiplayer: create, join by code on the code keypad, shared clay, turns | yes | e2e g |
| Settings: left-handed, one-handed, reduced motion, high contrast, sound, vision check | yes (untested) | in-world panel |
| First-run coach (tutorial) | yes | skipped by a poke in the scripts |

## Gaps left (planned)

1. **Panels cannot be grabbed, moved or pinned**: they follow the clay or the head (Stage C, 4.3).
2. **No seated-height calibration**: the virtual table is at 0.72 m; a real desk is used when found (Stage C).
3. ~~The menu has 9 categories~~ Done in Stage B (R4): Make, Colour & Material (with Paint), Bring to life (with Pin, Remove, Clear, Recenter), Play (Make it a game, Play Kit), Keep (Library), Room, and Settings and Help (?) as small icons. The browser toolbar shows the same.
4. **No Help panel with the build id** (section 7, Stage D). Help (?) now replays the first five minutes.
5. ~~Emulator and unpkg in the production build~~ Done in Stage A; the hand models ship with the app since Stage B.
6. **The VR room is plain** (flat colours, no textures): polish in Stage C (4.4).
7. Gaze is not used (optional).

## Stage B (2026-10-28): first five minutes, visible agent, simpler menu

Evidence: `QA_STEPS=h` in `qa/e2e/xr-e2e.spec.ts` (scripted emulated hands, not a real Quest), run `stageB-h`: 9/9.

- **First five minutes (4.1):** shown on first launch above the clay, four steps, hands only: pinch and pull (a drawn
  pinch-and-pull picture) -> one tap on "Bring to life" on the card -> one tap on "Make it a game" -> play. Then a
  success card (time, score or win, stars, a short fanfare) and where to go next. Skip any time; never shown again
  once done or skipped (settings, stored locally); the menu's Help (?) shows it again. Scripted run: 22 s.
- **Visible agent (4.2):** Play -> "Make it a game" (or the card) highlights the creation, shows "I'm looking at your
  creation…", then what it saw (size, mass, pieces and materials, shape), the rule, **why** it suits this shape, and
  a "Referee check passed" badge after the physics dry run. Play (accept), Adjust (tweak with number cards),
  Explain (the rules in plain sentences, for any game), Cancel. The creation plays the main role (ball, cup or
  target, from its measured shape); all code, offline (`client/src/game-agent/look.ts`, unit-tested).
- **Honest limits:** the "parts" are the creation's pieces and materials, not named body parts; the highlight glows
  the whole creation, not each piece. Nothing here is verified on a real Quest.
