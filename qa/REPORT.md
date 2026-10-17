# ClayMind XR end-to-end test (scripted hands, recorded)

2026-10-17. Test: `qa/e2e/xr-e2e.spec.ts` (+ `driver.js`, `flows.js`, `flows-more.js`), Playwright 1.64 with its
own Chromium 156, headless on the GPU (ANGLE / Direct3D 11, Intel Iris Xe), release build (`vite preview`, port
5191) and the local backend (port 8790). Recordings (git-ignored): `qa/recordings/<run>/`.

**These are scripted hands: test evidence, not a user video.** IWER's emulated hands were placed and closed by
the test program, frame by frame. A real hand can do what they do, but this says nothing about how it feels,
how reliably a real pinch is tracked, or what a player would try.

## How the hands were driven

The installed IWER (`node_modules/iwer`) has a programmatic API, so the emulator's own on-screen controls were not
needed: `XRDevice.controlMode = 'programmatic'`, `primaryInputMode = 'hand'`, `grantOfferedSession()`, then each
hand's `position` / `quaternion`, its `poseId` (`default`, `pinch`, `point`) and `setPinchValueImmediate(v)`
(blends the hand from open to pinched), once per rendered frame. (`device.remote.dispatch('animate_to' |
'set_hand_pose' | 'set_select_value' …)` exists too; the direct properties were simpler to step frame by frame.)
Every action in the test is a hand action:
- **menu:** the left palm turned up opens the wrist menu, the right index fingertip pokes its buttons from the front;
- **panels:** a fingertip poke on the region's world position (computed from the panel's registered hit regions);
- **sculpting, grabbing:** the hand closes on the spot (the pinch point stays on it while the fingers close);
- **pointing:** the index finger aimed at the toy, held still;
- **typing:** fingertip pokes on the pinch keypad;
- **throwing:** pinch, lift, draw back, swing at about 2 m/s, open the hand mid-swing.

Moves are at most 1.5-5 cm per frame (the app treats bigger jumps as tracking glitches).

## Results: first run vs last run

| Step | Check | First run | Last run |
|---|---|---|---|
| 0 | XR session, both emulated hands tracked | PASS | PASS |
| a | add clay (Add tool, pinch-draw) | PASS (675 -> 733 cm3) | PASS (675 -> 737) |
| a | grab and pull (Shape tool) | PASS | PASS (16.7 -> 18.1 cm) |
| a | two-hand scale | PASS (1.00 -> 1.67) | PASS (1.00 -> 1.71 -> 0.93, scaled back) |
| a | smooth | PASS | PASS |
| a | remove a bit (Carve) | PASS | PASS (592 -> 564 cm3) |
| b | colour for one piece | PASS | PASS |
| b | paint on the surface | FAIL (test) | PASS (0 -> 196 painted vertices) |
| b | bring to life | PASS | PASS |
| b | material for the object | PASS (clay -> steel) | PASS |
| c | grab the object | PASS | PASS |
| c | let go past the edge: lands below the table | FAIL | PASS (lands on the floor, bottom -0.002 m) |
| c | no tunnelling | PASS | PASS (lowest bottom -0.002 m) |
| c | reset | FAIL (test) | PASS (Remove from scene) |
| d | one creation to the Library | PASS | PASS |
| d | three different creations to the Play Kit | FAIL (test) | PASS (14x9x10, 10x16x10, 10x9x10 cm) |
| e | game from a card, backend on | PASS | PASS (Knock-down, physics tested) |
| e | two kit toys placed (Kit -> Place) | PASS | PASS |
| e | Describe view opens | (not checked) | PASS |
| e | point at a toy + "ball" chip | PASS* | PASS (Toy 1 = the ball) |
| e | point at a toy + "target" chip | PASS* (wrong toy) | PASS (Toy 2 = the target) |
| e | words on the keypad ("knock them down") | PASS | PASS |
| e | Make it | PASS | PASS* (Target throw, your Toy 1 as the ball; see 8 below) |
| e | backend off: the offline line | PASS | PASS |
| f | game starts with its rules shown | PASS | PASS |
| f | throw by hand: it scores (stricter) | FAIL | **FAIL** (2 lobs counted, no ball in a cup) |
| f | reset (HUD Reset) | PASS | PASS |
| g | create a room | PASS | PASS |
| g | join by code on the keypad | PASS | PASS |
| g | shared clay: same clay for both | FAIL (test) | PASS (20 edits each, checksums equal) |
| g | host starts a game, the other mirrors it | PASS | PASS |
| g | one turn: blocks go down, same score for both (stricter) | FAIL | **FAIL** (Shots 1/3 on both, lane clear, 0 blocks down) |
| | **Total** | **25 / 32** | **31 / 33** |

\* the first run's "target" chip bound the same toy as "ball": the pointing ray passed through the first toy.
(The first run's checks were looser; the last run's checks are stricter, e.g. Make it must come from the Describe
view and the shared clay must have equal checksums.)

Last run: `recordings/after-2026-10-17-18-42` (branch `fix-words-throws`). The two throw checks are now strict
(a ball must go in, a block must fall); an earlier run passed them on "the shot was counted" alone.

## What is visibly wrong (from the frames)

Frames: `steps/NN-<page>-<step>-<flow>.png` (one per flow), `keyframes/NN-<step>-<pass|FAIL>.png` (cut from the
video with ffmpeg at each result), contact sheets `contact-*.png`. Hands are visible as outlines in every frame;
the menus are readable; no object passes through the table or the floor.

1. **Tutorial text cut off** (first run `steps/02-A-a-sculpt.png`): "Palm up -> Paint -> Color: pick a / colour,"
   the rest of the sentence missing. **Fixed** (last run `steps/02-A-a-sculpt.png` shows the whole sentence).
2. **Panels show the text behind them** (first run `steps/07-A-e-describeGame.png`): the Play Kit HUD's lines
   show through the game panel. **Fixed** (panel background 88 % -> 96 % opaque).
3. **The game panel covers the Play Kit HUD** (last run `steps/07-A-e-describeGame.png`): both are placed by the
   clay. **Not fixed**: the HUD is readable again once the game panel closes.
4. **Your creations stand in the game's way** (run 3 `contact-throw.png`, big creations between the balls and the
   pyramid): living creations stayed on the table when a Play Kit game started, and the thrown ball hit them.
   **Fixed for one player** (last run `steps/08-A-f-playGame.png`: the lane is clear; they come back when the
   game ends). **Not in a room** (last run `steps/14-A-g-turn.png`): there they are shared with the others, so
   they stay, and they still block the throw. **Fixed in a room too:** the host puts them away and back (shared, so
   the others see it); the last run's lane is clear.
5. **Pushed off the table, it comes back by itself** (last run `contact-landing.png`, head turned to watch): the
   object falls past the edge onto the room's sofa (0.43 m) and about 1 s later the out-of-reach rescue floats it
   back beside the clay. Physics is right (it falls, lands, does not tunnel). **The "sofa" was an app bug:** a
   detected room plane's physics slab sat on the wrong side of the plane, an invisible floor about 0.45 m up.
   **Fixed:** the slab goes on the side away from the head; the last run lands on the floor (bottom -0.002 m). The quick return may surprise a player who
   pushed it off on purpose: worth a decision.
6. **The scripted throws never score** (`f`: Target throw, 1 throw, 0 in; `g`: Knock-down, 0 blocks down): the
   shot is counted and the turn passes on both players, but the scripted swing (about 2 m/s, released midway)
   misses. Not proven to be an app bug; aim and release timing need real hands.
   **Since then:** one player alone, a straight scripted throw knocks 5 of 6 Knock-down blocks over (probe). A
   scripted 45-degree lob into the Target-throw cups never went in (about 15 tries at 5 strengths: the release speed
   from the emulated hand is uneven at about 40 fps). In the room the lane is now clear (`steps/14-A-g-turn.png`)
   and the ball reaches the pyramid, but with two pages on one GPU (about 9 fps) it does not knock a block down.
   Both stay FAIL; real throws need a Quest.
7. **"Make it" chose Target throw for "knock them down" + a target chip** (online, a free model): the code's own
   choice from the chips and words is Knock-down (unit test), but only the words were sent. **Fixed in code:** the
   code's choice now goes to the agent as the game's name (the words still go as the player's rules). Not measured
   live: the free models had no budget left when it was tried, and the fallback is then the built-in Knock-down.
8. **Not app bugs, found and fixed in the test harness** (they cost most of the time and are written down so the
   next run does not repeat them):
   - the emulator jumps between hand poses: closing the hand moves the pinch point 7-8 cm in one frame, so a
     pinch "on the clay" started far from it and the Shape tool sent drags from 4 cm outside the surface (pull
     looked weak, 0.4-0.9 cm for 5 cm); fixed by closing the hand gradually with the pinch point kept on the target;
   - the emulated right palm faces down by default, and a carried object drops when the palm turns down, so every
     new creation fell out of the hand at once (Bring to life flies it into your hand): the test holds the hand
     over the table instead; a real hand is usually palm-in;
   - "Clear scene" only takes Library copies (by design; the reset now uses Remove from scene); a colour swatch only
     picks a colour ("Colour piece" applies it); painting in the piece's own colour leaves no visible mark; a
     small ball in a game that allows flicks starts the assisted flick until it is lifted 5 cm;
   - "Open Play Kit" toggles: pressed while open, it closes;
   - the two-hand scale step left the clay 1.7x, so every later creation was 1.7x too: the test scales it back.

## Frame rate (emulator, desktop GPU, not a Quest)

fps sampled at the end of each step (headless Chromium, stereo XR rendering on an Intel Iris Xe):

| | a | b | c | d | e | f | with a 2nd player open |
|---|---|---|---|---|---|---|---|
| first run | 56.5 | 28.0 | 28.2 | 22.2 | 42.6 | 28.1 | 10.9 |
| run 4 | 57.9 | 56.7 | 45.3 | 39.8 | 34.9 | 14.3 | 9.4 |
| last run | 55.8 | 56.0 | 48.8 | 48.9 | 18.8 | 34.7 | about 9 |

The two-player numbers have both pages rendering on the same GPU. f went from 14 to 35 fps after the Play Kit HUD
stopped repainting every frame (it repaints only when its text changes); e is sampled while waiting for the agent.
These are not Quest numbers.

## Fixes made (app)

1. `client/src/ui/canvas-panel.ts`, `ui.wrap`: the last allowed line keeps the remaining words and ends with an
   ellipsis instead of dropping them (it stopped after one word); affects every panel that wraps text.
2. `client/src/ui/canvas-panel.ts`, `ui.panel`: background 96 % opaque (was 88 %), no text bleeding through.
3. `client/src/playkit/playkit-system.ts`: when the Play Kit takes the table (a game or a Set), living creations
   standing on it are saved with their pose and taken off, like the clay is hidden; they come back when the table
   is left (not in a room, where they are shared).
4. `client/src/index.ts`: `?debug` also exposes the table surface (`__surface`) for tests.
5. `client/src/platform/surface/surface-system.ts`: a room plane's physics slab goes on the side away from the
   player's head (it made an invisible floor about 0.45 m up).
6. `client/src/playkit/playkit-system.ts` + `multiplayer/shared-bodies.ts`: in a room the host puts creations away
   for a game and back after; the HUD repaints only when its text changes.
7. `client/src/ui/wrist-menu.ts`: after a press nothing else is pressed until the fingertip leaves every button.
8. `client/src/game-agent/game-agent-system.ts`: "Make it" sends the code's game choice with the words; typed
   words never change a role given with a chip; "this" typed while holding one piece is that piece.

## Still needs a real Quest

Pinch reliability and reach for a seated player; whether a real pinch starts within the 1.5 cm the Shape tool
needs; pointing at a toy with a real index finger (dwell 0.3 s); typing on the pinch keypad; aiming and releasing
a real throw (the scripted ones missed); how a creation flying into a real hand feels (and whether it drops);
the thumbs-up; two-hand scale with real hands; frame rate in the headset with a Set and 3 players; two headsets in
one room.

## Re-run

```bash
cd client && npm run build
```

```bash
QA_LABEL=after npx --prefix client playwright test -c qa/e2e/playwright.config.ts xr-e2e
```

`QA_STEPS=a,b` runs some steps; `QA_HEADED=1` shows the browser; `QA_GL=swiftshader` renders without a GPU.
`qa/node_modules` is a link to `client/node_modules` (git-ignored); recreate it with
`New-Item -ItemType Junction -Path qa\node_modules -Target client\node_modules` (PowerShell) or a symlink.
