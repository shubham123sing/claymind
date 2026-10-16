# Update 2, Step 5: test everything in the XR emulator

Date: 2026-10-15. Branch `update-2-playkit`. Run in the web build's XR emulator (IWER, Meta Quest 3
profile) with **emulated hands** (`primaryInputMode = 'hand'`, programmatic poses: default / pinch /
point), seated head at 1.15 m, virtual table top at 0.72 m. Hands were moved in steps of 3 cm or
less (5 cm for throws), as a real hand moves between frames. Backend: `server/agents` on
127.0.0.1:8790 with the free Groq chain; then switched off for the offline checks.

## Results

| Area | Test | Result | Numbers |
|---|---|---|---|
| Environment | XR session, table, clay, hands tracked | ✅ | session active, both hands tracked, 57 fps idle |
| Sculpting | pinch on the clay surface and pull 4 cm | ✅ | width 11.0 → 14.9 cm |
| Kit | Bring to life → Add to Play Kit → place → Save Set → reopen → Play → Reset | ✅ | 1 kit item (role suggested: obstacle), Set saved and reopened with 1 piece, Reset exact |
| Templates (demo in XR) | Knock-down | ✅ | 3 throws, 4 / 6 down, 7.5 s, 45 fps |
| | Flick-and-pocket | ✅ | 10 flicks, a full game ("Player 1 wins with 4"), 20 s, 40 fps |
| | Target throw | ✅ | 5 throws, 10 points, 14 s, 36 fps |
| | Tower balance | ✅ | 4 placed, "Four high: you win!", 10 s, 40 fps |
| | Marble run | ✅ | 3 drops, "All three home!", 8 s, 41 fps |
| Hands | pinch-grab a ball | ✅ | 9 / 9 grabs held |
| | throw at the tower (2.7 m/s hand) | ✅ after fix | ball speed **0.7–1.2 → 2.0–2.95 m/s**; 3 blocks down |
| | fingertip flick of the striker | ✅ | shot counted, turn passed, striker slid 12 cm |
| | fingertip press on HUD buttons | ✅ | Show me how, My turn, Stop, Will it work?, What if…, option, Close |
| Make a game | carrom | ✅ | built-in Flick-and-pocket, sources: Carrom (Wikipedia) |
| | bowling | ✅ | Knock-down |
| | ring toss | ✅ | web: "Ring Toss" (3 cups, 5 balls), source: Ring toss page, 10–14 s |
| | Kubb (unknown) | ✅ after fixes | web: "Kubb Table" (6 blocks, 3 balls, 2 players), source: Kubb page, 13.5 s |
| | Mölkky (unknown) | ✅ after fix | web, source: Mölkky page, 11 s |
| | Surprise me | ✅ | Flick-and-pocket, instant |
| Teach me to build | snowman (10 steps), mistake: 22 cm instead of 10 cm | ✅ | Coach: "It is 22.0 cm wide, the step wants about 10.0 cm", fix "take off about 12.0 cm"; corrected → "Looks good!" |
| | coffee mug (8 steps), mistake: 17.6 cm instead of 8 cm | ✅ | same, fix "take off about 9.6 cm"; corrected → "Looks good!" |
| Step 3b | Show me how (XR, by fingertip) | ✅ | ghost hand + "Demo" label, live scoreboard |
| | My turn → the player throws the last ball by hand | ✅ | game continued from the exact state and ended ("Last turn played: 4 points") |
| | Will it work? (XR) | ✅ | straight tower passes; leaning tower fails, fix proven (browser) |
| | What-if, replay identical | ✅ | "Replayed with the same seed: the same result" (every run) |
| Offline (backend off) | Ask AI → Make a game | ✅ | one line in 2.7 s: "AI helper is offline, built-in games still work." (also in the helper bubble) |
| | Play Kit, demo, Will it work?, What-if | ✅ | all work with no network |
| Performance | helper + kit + physics + demo | ⚠️ emulator only | 36–45 fps in the desktop emulator (stereo render in a browser pane); not a Quest number |

## Hand actions that were awkward, and what was done

| # | Problem | Severity | Fix |
|---|---|---|---|
| 1 | **Throws lost half their speed.** The hand smoothing (1€ filter) had beta 0.03 for positions in metres, so a 2.7 m/s hand was followed at about half speed; the release velocity was also averaged over frames after the hand had slowed (and hand tracking sees the pinch open late). | high | **Fixed**: beta 4 (still hand: same 1.2 Hz smoothing; fast hand: ~10 Hz), and the throw uses the fastest ~40 ms of the last 150 ms. Tests: `throw-velocity.test.ts`, `xr-hands.test.ts`. |
| 2 | **Game HUD buttons were 2.1 cm tall** and the HUD was 0.50 m from a seated shoulder (near full reach). | medium | **Fixed**: buttons 2.8 cm tall; the HUD sits 12 cm nearer (0.38 m from the shoulder). |
| 3 | The helper's bubble could sit behind the HUD on the pressing side. | low | **Fixed**: the helper sits on the left (right for left-handed players). |
| 4 | Ask AI panel close button is 2.4 × 2.1 cm. | low | Listed: make it 3 cm. |
| 5 | Repeated throws mean lifting the arm each time (fatigue when seated). | low | Listed: Show me how and the 3-ball limit keep sessions short; a "rest" reminder could follow. |
| 6 | Flick needs the fingertip to pass through the piece's centre zone (radius + 1 cm). | low | Listed: re-test on a real Quest; widen to +2 cm if misses are common. |

Backend problems found and fixed in the same run: the Researcher read the wrong Wikipedia pages
(it now reads the page with the game's exact name first, when it is about a game); an answer
slightly longer than the schema was thrown away (it is now trimmed to the limits); the Qwen model
was asked for 2048 output tokens but its free tier allows 1000 per minute (now capped); a model
that fails to produce valid JSON now falls through to the next one; when every free model is busy
the player is told so (not "couldn't find the rules"), and the trace records it.

## Must be re-tested on a real Quest

Emulated hands are perfect: they never lose tracking, never jitter and pinch exactly. On a real
headset re-check: pinch grab reliability at the table edge; throw strength and direction with the
new smoothing (beta 4) and whether a still hand shakes when sculpting; the fingertip flick hit
rate; HUD press accuracy at 2.8 cm; frame rate (target 72 fps) with the helper, a full kit and a
demo running; text size of the helper bubble and the HUD at arm's length; seated comfort over
10 minutes.
