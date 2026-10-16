# QA report (V5)

Branch `v5-playkit-multiplayer`, 2026-10-16. Desktop Windows 11, Chromium browser pane, IWSDK's XR
emulator (IWER, Meta Quest 3 profile) with **emulated hands**. Nothing here was run on a real Quest:
hand feel, reach, fast swings and frame rate on the headset are still to be measured
(list at the end). Evals: `docs/EVAL_REPORT.md`.

## Automated tests

| Suite | Result |
|---|---|
| Client unit + physics (`client`, `npx vitest run`) | 136 passed, 2 skipped (the two live evals, run on demand) |
| Server (`server`, `pytest tests`) | 31 passed |
| Typecheck (`npm run typecheck`) | clean |
| Release build (`npm run build`) | clean; one warning: the main chunk is 8.2 MB (2.1 MB gzip), as before |

## Offline (no backend)

Release build (`vite preview`) with the backend address set to a dead port:

| Check | Result |
|---|---|
| Sculpt, Bring to life | works (bake 522 ms) |
| Game agent panel | says "offline" at once, built-in games stay |
| Point + Say, typed "play a knock down game" -> Make it | Knock-down chosen offline, physics test passed, game started |
| Console | only the expected failed request to the dead backend address; a normal load is clean |

## Multiplayer (two and three browser tabs, local relay)

| Check | Result |
|---|---|
| Create / join by code | joined in 22 ms (local) |
| Living objects shared (new in V5) | made by one player, appears for the others; hold (about 15 a second), release with the throw, rest pose: all arrived; the rest pose put the other copy within millimetres in x/z (resting height can differ by a few cm when it leans on the clay) |
| 3 players, late joiner mid-game | the third player got the clay, the shared object and the running game (mirrored) about 1.0 s after joining |
| Kit share | a shared toy goes to the receiver's Play Kit and Library |
| Latency (Update 3, unchanged) | own stroke after one round trip: about 0.1 s locally, 0.56 s at 250 ms each way (simulated) |

Test traps found (not app bugs): joining without the panel's `connect()` skips the room set-up; a test
that imports `table-frame.ts` again gets a second, unset copy and reads mirrored positions.

## XR emulator, emulated hands (release build)

| Check | Result |
|---|---|
| Point at a living object (index finger, 0.3 s) | "point" recorded every ~2 s while held; the chip "This is the ball" bound it |
| Mark a zone (pinch-drag a loop on the table) | a 6 cm loop became a zone of radius 5.9 cm |
| "Here is the goal" after the loop | missed at first (more than 2 s at the emulator's frame rate); fixed: it now takes the latest zone |
| A stroke while "Done" is pressed | was saved as a path; fixed: a stroke keeps the kind it started as |
| Make it (ball + zone) | Marble run chosen; the pointed creation went into the Play Kit; the physics test swapped it (an 18 cm lump is not a marble) and then fell back to the plain game because the moved finish is out of the ramp's reach (said in the preview) |
| Assisted flick (pinch the striker, pull back 10 cm, let go) | aim line shown, striker sent 12 cm toward the board |
| Held tool (a bat added to Knock-down) | held and registered as a tool; a slow push moved the blocks 0.3-1.9 cm; a fast swing could not be judged: at about 5 frames a second the physics runs in slow motion (4 fixed steps a frame at most) and the bat falls behind the hand |

## Hands only, safety, scope

| Check | Result |
|---|---|
| No microphone / speech input | none in `client/src` (no getUserMedia, SpeechRecognition, MediaRecorder) |
| New V5 controls reachable by hand | Describe chips and buttons are poked like every panel; zones and paths are pinch strokes; typing is the pinch keypad in XR; the vision switch is in Settings |
| Secrets | no `.env` tracked (only `server/.env.example`); no Groq / OpenAI / AWS keys or private keys in tracked files, in this branch's history since `master`, or in `client/dist` |
| Phone AR untouched | no AR file changed since `master` (the only change in a file that mentions AR is a type name in `input-system.ts`); phone-touch tests pass |

## Performance

The browser pane gives few frames when it is not in front (and none when hidden), so no frame rate from
this session is a fair number. What could be counted: the host with a game, a shared object and two
remote players draws 30 calls and 15k triangles per frame. Earlier measurements (`docs/PERF.md`):
typical creation about 60 fps, a Set idle about 42 fps in the desktop emulator. A Quest number is still
missing.

## Still to test on a Quest

Pinch reliability and reach seated; pointing and zone marking by real hands; fast swings with a held
tool; the thumbs-up detection; frame rate with a Set and three players; two or more headsets in a room.
