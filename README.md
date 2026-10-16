# ClayMind

Make things from clay with your hands, give every piece a real material and colour, paint them, and
they come to life with real physics: heavy, bouncy, fragile or slippery. Keep them in your Library
(export as GLB), turn them into toys in your **Play Kit**, play table games with them (or ask the game
agent to make a game from your own toys and your own rules), and do all of it **together**: 2-4 people
join one room by a code, build on the same table and play the same games. Everything you make
interacts with the room around it.

Meta Quest 3 / 3S (WebXR, hands only, seated, no microphone). A desktop browser works too (mouse,
or the built-in XR emulator). Sculpting, Library, Play Kit and the five built-in games work with no
network and no AI.

## Play it
Open the public link in **Quest Browser** and press **Start in mixed reality** (or **Enter XR** in a
desktop browser for the emulator). Follow the card above the clay.

## The menu
Quest: turn your left palm up and poke with your right index finger (Settings -> One-handed menu keeps it
beside the clay, with a Hide button). Browser: the toolbar on the left; the round button hides or shows it.
A category opens its actions, with **Back** first.

| Category | Actions |
|---|---|
| **Make** | Shape, Add, Carve, Smooth, Mirror, New piece, Join, Separate, Undo, Redo, New clay, Delete this creation |
| **Material & Colour** | Material (the ring of materials for the piece you touched), Color, Undo |
| **Paint** | Paint, Eraser, Color, Undo |
| **Physics** | Bring to life (the sculpt becomes a real object), Undo |
| **Place & Pin** | Pin / Unpin, Remove from scene, Clear scene |
| **Library** | Open Library, Add to Library |
| **Play Kit** | Open Play Kit (Kit, Sets, Games, Make a game with AI), Add to Play Kit |
| **Multiplayer** | Create or join a room |
| **Settings** | reduced motion, high contrast, left-handed, one-handed menu, sound, the tutorial again, reset |

## What you can do
- **Make:** pinch the clay and pull to stretch it, point a finger into it to dent, open palm to smooth,
  both hands to turn or resize. New piece starts another piece in its own colour.
- **Material, colour, paint:** after Bring to life, touch a piece and pick its material: mass, balance,
  friction, bounce and breaking follow it. Colour a whole piece or paint on the clay with your fingertip.
- **Physics and the room:** objects rest on the table, roll off its edge, bounce off the walls and land on
  the floor, with each surface's friction (table wood, floor and walls stone). In the XR environment the
  room's own walls, floor, ceiling and furniture are colliders; without them, invisible walls stand 2 m
  around the table. Nothing is ever lost: a creation that leaves the room floats back to the table, a Play
  Kit piece goes back to its start. Pin fixes an object where it is.
- **Library:** nothing is saved by itself; Add to Library saves a copy (named, with a thumbnail). Use, Edit,
  Rename, Download, Delete (with Undo), Import. Stored in this browser only.
- **Play Kit:** your toys (with a role guessed from their shape), Sets (a table arrangement, saved), and
  five games run by a deterministic rule engine: Knock-down, Flick-and-pocket, Target throw, Tower balance,
  Marble run. Pinch to pick up and throw, flick with a fingertip, push, stack. Edit / Play, Pause, Reset
  (exactly back to the start), Rules, Save Set, End. **Show me how** on a game card lets a translucent
  "Demo" hand play a few turns (Pause, Slow, Replay, My turn).
- **Multiplayer:** see below.

## Download format (for game developers)
**Download** asks the licence (*Keep my rights* or *CC0*, written into the GLB's `asset.copyright`), then:
- **`<name>.glb`**: binary glTF 2.0 (Unity, Unreal, Godot, Blender, three.js): a root node named after the
  creation, one child per piece `piece_<n>_<materialId>`, one PBR material per piece (base colour, roughness,
  metalness, opacity; glass blends), paint as vertex colours (`COLOR_0`), welded indexed triangles, metres,
  Y-up, origin at the centre of the base, and physics in `extras.claymind` (pieces with material, mass,
  density, friction, restitution; total mass; centre of mass). Checked with the Khronos glTF validator in the tests.
- **`<name>.claymind.json`**: the full project (pieces, paint, colliders, materials, colours) to import again.

## The game agent (optional)
Play Kit -> Games -> **Make a game with AI**: tap a game (Carrom, Bowling, Ring toss, Jenga, Marble race),
*Surprise me*, type a name, *I don't know the rules: look them up*, or *My own rules* (number cards for
players, turns, shots, win target, time limit, plus your own words; typed in the browser, or on the pinch
keypad in the headset). The preview says which path ran, how to play, which of your toys play which part,
what is missing or not possible, and the sources; **Play**, **Show me how**, **Adjust** (a rules card,
checked again here) or **Cancel**.

**Show me with my hands (Point + Say):** point at a piece (or hold it up, or tap it) and press what it is
(*This is the ball / target / goal / board / tool / launcher*), mark the goal or a path on the table with a
pinch-drag, type the rest if you like ("these are the pins"); **Make it**. The pointing words bind to what
your hands showed within 2 seconds, in code (no AI); one short question when two pieces were shown at once.
Offline it picks the built-in game that fits and puts your toys and marks in it; online the agent reads your
words too, and your pointing still wins. Every designed game is first played in the same physics (the
Referee's dry run); a toy that does not work in its role is swapped for the built-in piece, and you are told.
Optional **Vision check** (Settings, off by default): pictures the game renders of a new Play Kit toy go to a
free vision model, which suggests what it looks like (with Undo). There is no camera: the Quest Browser gives
web apps no camera feed.

The agent team (`server/agents`, FastAPI + Agno AgentOS, one process):
- **Kit Analyst** (code): a shape report and roles for each toy from its measured geometry.
- **Intent Resolver** (LLM, only when needed): which role a pointed-at piece plays, from typed words the code
  could not read; it only names your pieces, never others.
- **Researcher** (LLM): Wikipedia only when you do not know the rules or name an unknown game; the page with
  the game's own name first; a Rule Card in its own words, with sources. Web text is screened for prompt
  injection and summarised, never followed.
- **Game Designer** (LLM): your rules or the Rule Card -> a built-in game plus changes (players, turns,
  pieces, win target, time), or a full Game Spec when none fits. Your own rules always win over the web.
- **Referee** (code): the Game Spec checked (only fixed triggers and actions, no code), plus "can it be won";
  at most two repairs, else the closest built-in game, and you are told.
- The game flow reaches the Researcher and the Designer over **A2A** on the same server. Free Groq models go
  through a quota governor (per-minute and per-day budgets, fall-through, circuit breaker); answers are
  cached; unsafe requests are refused without AI. About 30 built-in Rule Cards are used before any web search.
  Evals: `eval/playkit/`, `eval/pointsay/` and `docs/EVAL_REPORT.md`; QA: `docs/QA_REPORT.md`.

## Multiplayer (room code)
Menu -> **Multiplayer** -> **Create a room** (a 5-character code of easy letters and digits) or **Join a
room** (type the code, or poke it on the keypad). 2-4 players, a name and a colour each; the host can remove
a player; anyone can leave; rooms disappear when empty. No accounts, no voice.

- **Relay:** one WebSocket service on the same backend (`/v1/rooms`), memory only: it orders and forwards
  messages and never runs anything a client sends. Limits: 4 players, message size caps, messages per second
  per socket, sockets and new rooms per IP, origin check, names filtered.
- **One table for everyone:** each player's own table is the shared table; seats around it by colour, so the
  others sit across from you as a simple head and two hands with a name tag (about 15 updates a second,
  interpolated). Wave with a raised hand or hold a thumbs-up to say hi.
- **Building together:** the clay is shared at the table's centre. Strokes, Undo and Redo travel as edit
  operations (never meshes) with a room sequence number and every client applies them in that order; Undo is
  per player. A late joiner gets the host's snapshot plus the edits after it; the host sends a checksum every
  5 s and a client that differs resyncs from the host.
- **Playing together:** host-authoritative. The host starts a game (set to the room's players: turns, names
  on the scoreboard; one-turn games give each player the same set-up), runs the physics and the rules, and
  sends the moving pieces, scores and whose turn it is about 15 times a second. On your turn you grab and
  throw with your own hands: your hand's pose goes to the host (the piece is locked to you), the release
  sends the throw. If the host leaves, the game ends cleanly and the next player hosts the room.
- **Game agent in a room:** anyone can make a game; a player's choice goes to the host, who decides.
- **Shared Play Kit:** Kit -> Share sends a toy to the room; everyone gets a copy in their own Play Kit and
  Library.
- **Living objects:** what you bring to life in a room appears for everyone; holding it shows it moving for
  the others (they cannot take it meanwhile), a throw runs in every table's physics and the resting pose
  re-aligns them; deleting it removes it for everyone; a late joiner gets them all.

## Run it
- **Client:** Node 24; `cd client && npm install && npm run dev` (HTTPS on port 8081, opens the IWSDK
  emulator browser). Quest on the same Wi-Fi: `https://<your-pc-ip>:8081/`, accept the certificate, Enter XR.
  Tests: `npm test`; types: `npm run typecheck`. `?debug` shows the performance HUD.
- **Backend (game agent and multiplayer):** `cd server`, `python -m venv .venv`,
  `.venv/Scripts/python -m pip install -r requirements-agents.txt`, copy `.env.example` to `.env` and put
  `GROQ_API_KEY=...` in it, then `.venv/Scripts/python -m agents.run` (http://127.0.0.1:8790). Tests:
  `.venv/Scripts/python -m pytest -q` (no network). The game finds it at `http://127.0.0.1:8790` when it runs
  on the same computer, or `?agents=<url>` once.
- **Without the backend:** just the client. Sculpting, Library, Play Kit and the built-in games work; the game
  agent and multiplayer say in one line that they are offline.
- **Release:** `cd client && NODE_ENV=production npm run build` -> `client/dist/` (static). GitHub Pages:
  `.github/workflows/pages.yml` tests, builds and publishes from `master`.

## Layout
- `client/`: IWSDK + Vite + TypeScript (`src/sculpt`, `src/objects`, `src/physics`, `src/playkit`,
  `src/game-agent`, `src/multiplayer`, `src/platform`, `src/ui`).
- `server/agents/`: the game agent team and the room relay.
- `eval/playkit/`: the game agent eval set.
- `docs/`: QA_REPORT, EVAL_REPORT, KNOWN_LIMITS, CREDITS, AUDIT_UPDATE_3, plans and earlier reports.
- `_archive/`: code removed in Update 3 (old AI layer, brain graph, spikes, old AI server), kept for reference.
