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
6. ~~The VR room is plain~~ Stage C: a drawn window view (sky, hills, frame); still flat-coloured walls. And the headset's own Enter button now opens VR (it opened mixed reality before).
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

## Stage C (2026-10-28): hand quality, sound, multiplayer, robustness

Evidence: scripted emulated hands (IWER), release build; not a real Quest. Full run `stageC-full3`: 61/61
(steps h, a-g and the new r, plus a no-overlapping-panels check after every flow); autosave reload test pass;
153 unit tests.

- **Poke intent (4.3):** every panel and the palm menu press only after the fingertip aimed at one
  button from the front (within 10 cm, at least 60 ms) and then crossed it; sliding in from the side,
  going right through, a quick brush or a pinching hand presses nothing (`PokeGate`, 6 unit tests).
  The aimed menu button keeps a 6 mm wider hit box (shaky hands); an open palm menu survives a 0.5 s
  tracking loss of the palm hand. **Either hand** now pokes panels (before: the right hand whenever it
  was tracked, which left-handed and one-handed players could not use).
- **Clay first (4.3):** a pinch on the clay's surface sculpts even with a creation resting against
  the lump; the creation takes it only when the fingers are on its own shape (within 4 mm). Found by
  step r: Library "Use" put creations inside the clay, so the next pinch on the clay grabbed them;
  they now land beside the clay.
- **Grab feedback (4.3, 4.4):** a free hand within grab reach makes the object glow faintly; a grab
  pops and flashes; letting go plays a soft note (louder for a throw); each point scored dings (one
  step higher per point) and the scoreboard's edge lights green once. All sounds are procedural.
- **No overlapping panels (4.4):** the e2e now projects every visible panel to the screen after each
  flow and fails on overlaps; the success card moves left of the game's scoreboard.
- **Multiplayer (5):** a BETA tag; the room panel says whether the room server is ready, waking up or
  unreachable (and wakes it when opened); a dropped connection rejoins the same room by itself (three
  tries, 1.5 / 4 / 9 s), and the table comes back from the host's snapshot. Host leaving: the next
  player becomes host (relay, unchanged) and keeps the table. Both are now in e2e step g.
- **Robustness (6):** e2e step r: a 50 ms loss while holding keeps the object; a 0.4 s loss mid-grab lets
  go cleanly and the hand can grab again; crossing hands leave nothing stuck; 8 rapid tool pokes; then
  sculpt, grab and drop with **noisy hands** (1 cm whole-hand wobble, 2 mm per joint, a 0.2-0.5 s dropout
  every 2.5-5 s); no uncaught errors.
  Menu presses under noise (18 presses each): clean 18/18; 1 cm wobble 16 right, 1 wrong, 1 missed;
  1 cm white jitter 17/1/0; with dropouts 8 right, 1 wrong, 9 missed (the poking hand vanished; a
  retry works). A wrong press is rare but possible with 1 cm noise.
- **Autosave (6):** the clay (with undo history) and loose creations are saved locally every few
  seconds and when the page is hidden; a reload brings both back (`qa/e2e/autosave.spec.ts`: same clay
  checksum, same creation).
- **Performance (6):** a frame-rate governor and a Performance mode setting; CPU 4x / 6x throttle
  measured (`docs/PERF.md`).
- **Still open:** panels cannot be grabbed and moved (gap 1); no seated-height calibration (gap 2);
  no Quest test (no device).

## Stage D (2026-10-29): 4.5, 4.6, release rehearsal
- **Daily challenge (4.5):** Play -> Today's challenge. One goal a day from the date alone (no backend,
  the same for everyone; six goals, never the same two days in a row): a 20 cm tower, three pieces,
  two materials, a hard throw (>= 2 m/s), 3 points in a game, a won game. The game checks it from what
  happens; done = a fanfare and a toast with the days-in-a-row streak (IndexedDB). In the full run the
  day's goal ("Win a game") was completed by step f's real game on its own. Unit tests: 4.
- **Accessibility (4.6):** Large text setting (headset panels 1.25 -> 1.5, still no overlaps);
  `docs/ACCESSIBILITY.md` lists what is supported and what is not.
- **Help / build id (gap 4):** Settings -> About: six lines of how to play, today's challenge, what
  needs the internet, and the build id (commit + date, from `vite.config.ts`). The tutorial card now
  steps aside while Settings is open (it overlapped with Large text on).
- **Release rehearsal:** `qa/e2e/smoke.spec.ts` (loads clean, no outside hosts, names its build,
  backend unreachable still clean, Enter VR = opaque VR session) and `docs/RELEASE.md`.
  Local release preview: 4/4. **The live Pages site fails 3/4: it is still the V5 build** (loads
  unpkg, offers mixed reality, no build id), because none of the V6 branches are on GitHub yet.
- **Evidence:** full e2e 64/66 (x2 was a test bug, fixed and re-run with f,x: 10/10; the room throw
  is the known flaky one); unit tests 157; smoke 4/4 locally.

## Gap 1: movable panels (2026-10-29)
- `PanelMoverSystem` (after the panels are placed, before objects and sculpting): a grab bar above each
  panel; a pinch on it is claimed ('panel'), so it never sculpts or grabs. `CanvasPanel.applyMove()`
  puts the panel at its owner's place plus the player's offset, also right before a poke, so buttons
  work where the panel is. Recenter clears every offset.
- e2e step m: drag Settings 16 cm (clay untouched), poke About on it there, reopen where it was
  left, Recenter back: 5/5. Full run 68/70 (see KNOWN_LIMITS).

## Gap 2: seated height (2026-10-29)
- `SeatedHeightSystem`: moves `world.player` (the camera's parent) vertically; hand poses read from XR
  get the same offset (`xrOrigin` in hand-state.ts), so hands, camera and panels agree. A first try with
  an offset XR reference space put the emulated view in the wrong place, so it moves the rig instead.
- Bring to life -> Table higher / Table lower (3 cm, saved as `tableAdjust`). Unit tests: 3.
- e2e step k: normal chair no shift; a head 25 cm lower + Recenter: eyes 45 cm over the table, hands
  27 cm higher with it; sculpting by hand still works; nudges 3 cm and back; back to normal: 7/7.
- Full e2e 76/76. Two earlier misses (k3 and the room's "shared clay pull") came from the test pulling
  on the clay's right side, where creations from earlier steps rest against it (clay-first rule: they
  take the pinch); both now pull on the free left side.
