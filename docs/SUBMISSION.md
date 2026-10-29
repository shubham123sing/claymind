# Demo video and submission (V6 section 8): plan and draft

Record after the freeze (13 Nov) from the exact published build (its id in Settings -> About).
Until a Quest is available, footage is from the **XR emulator in a desktop browser**: say so on
screen and in the description ("recorded in the WebXR emulator, not on a headset").

## Video (under 3 minutes, 1080p or higher, large captions)
| Time | Shot | Caption |
|---|---|---|
| 0-10 s | Hands pinch and pull the clay into a small creature | "Sculpt with your hands" |
| 10-60 s | Bring to life: it drops on the table and rolls. Play -> Make it a game: the agent panel shows its steps (looking at the creation, picking a game, checking the rules) and the game starts | "It comes alive. An agent makes a game from it" |
| 60-100 s | Two players in a room by code: one sculpts, the other sees it; a turn each | "Play together with a room code (beta)" |
| 100-130 s | Library (save, use again) and Play Kit (toys, Sets); today's challenge done | "Keep what you make" |
| 130-160 s | One line on how it works, one on limits | "Physics and games run on your device; the AI only fills a checked game form, it never writes code. Not yet tested on a Quest." |
| End card | Link, "Hands only. Free." | |

### Making it again (after the freeze)
The footage is scripted with the emulated hands on the published build, then cut with ffmpeg:
1. `QA_DEMO=1 QA_URL=https://shubham123sing.github.io/claymind/ npx --prefix client playwright test -c qa/e2e/playwright.config.ts demo`
   records `qa/recordings/demo-<time>/` (`A.webm`, `B.webm`, `marks.json`; scenes in `qa/e2e/demo.js`).
2. `python qa/video/edit.py qa/recordings/demo-<time> submission/claymind-demo.mp4` (needs numpy and an
   ffmpeg with libx264 and drawtext: `pip install imageio-ffmpeg numpy`, or `FFMPEG=<path>`).
   It adds title, "how it works" and end cards, the two players side by side, close-ups and the
   music, which `qa/video/music.py` makes from scratch (no outside tracks, no licence questions).

Zoom into the agent panel and the HUD so text is readable. No AI-generated footage, no voice-over
needed (captions only), no brand names or real people.

## Tagline (140 characters max)
Sculpt clay with your bare hands in VR, bring it to life with real physics, and turn it into a game to play alone or with friends.

## Submission text (draft)
**Inspiration.** Clay is the first thing many of us made things with. We wanted that in VR: no
controllers, no menus to learn, just hands, and what you make should do something.

**What it does.** You sculpt with pinches and pokes, give pieces materials and colours, and Bring to
life turns the sculpt into a physical object with its own mass and balance. Make it a game looks at
the creation and builds a game around it (a ball, a cup, or a target to knock down); the Play Kit,
the Library, a daily challenge and room codes for multiplayer (beta) give reasons to come back.

**How we built it.** IWSDK (WebXR) and three.js, Havok physics, a custom sculpting engine in a web
worker (signed-distance clay meshed on the fly), procedural sounds. The optional game agent runs on
a small server with free open-weight models; it only fills a fixed, validated Game Spec (triggers
and actions from a fixed list), never code, and every game also exists built in, so everything
works offline. Tested with scripted, noisy emulated hands in an end-to-end suite.

**Accessibility.** Seated and hands only; one-handed and left-handed modes, large text, high
contrast, reduced motion, sound optional, no flashing (`docs/ACCESSIBILITY.md` lists what is not
supported).

**Honest limits.** Not yet verified on a Quest; multiplayer is beta on a free server that can sleep;
"make it a game" works from shape and size, not from what a creation depicts
(`docs/KNOWN_LIMITS.md`).

**Next.** Testing on Quest hardware and
sharing creations between players' Libraries.
