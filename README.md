# ClayMind (working title)

Sculpt, paint and build with real materials in your own room (Meta Quest 3/3S, WebXR, hands only, seated). What you make is heavy, bouncy, fragile or slippery for real: every piece has its own material, and the physics (weight, balance, friction, bounce, breaking, sound) follows it. Fully offline: no server, no account, no AI. Plan: `docs/PLAN.md`; status and limits: `docs/`.

## Play it
Open the public link in **Quest Browser**, press **Start in mixed reality**, and follow the card above the clay. (A desktop browser works too, with the mouse.)

## Run (development)
1. Install Node 24, then `cd client && npm install`
2. `npm run dev` starts an HTTPS dev server on port 8081 and opens the IWSDK emulator browser.
3. Quest: same Wi-Fi, open `https://<your-pc-ip>:8081/` in Quest Browser, accept the certificate warning, then press **Enter XR**.
4. Tests: `npm test` · types: `npm run typecheck`

## Release build and deploy
1. `cd client && NODE_ENV=production npm run build` -> `client/dist/` (about 10 MB, static files only).
2. GitHub Pages: push to GitHub, then Settings -> Pages -> Source: **GitHub Actions**. `.github/workflows/pages.yml` tests, builds and publishes on every push.
3. Headset test: `docs/QUEST_TEST.md`.

## Supported devices
- **Meta Quest 3 / 3S** (Quest Browser): the full hands-only mixed-reality experience.
- **Desktop browsers** (Chrome, Edge, Firefox, Safari): the 3D view with the mouse, plus the Library, Download and Import.
- Phone AR is not part of this update (unchanged).

## Menu
- **Browser:** the round button at the bottom left hides or shows all tools (and the hint line and welcome card), so the view can show only your creation, the scene and that button. The choice is remembered.
- **Quest:** turn your palm up for the menu (it hides when you lower the hand). With **Settings -> One-handed menu** the menu stays beside the clay; its small **Hide** button folds it down to one **Tools** button.
- **Delete** removes what you are making now (the object you touched last, otherwise the clay): press it twice within 3 s, then you have 5 s to **Undo** (the toast's Undo button, the menu's Undo, or Ctrl+Z).

## Library and Download
- Nothing goes into the Library by itself. **Add to Library** (menu or the Library panel) asks a name (default "Clay 1", "Clay 2"; the headset uses the default) and saves a copy with a thumbnail.
- **Library** shows a grid. Select an item, then: **Use** (a copy into the room; the item never changes), **Edit** (a linked copy: changes you make are saved back to the item), **Rename** (browser), **Download**, **Delete** (two taps, then 5 s to Undo). **Import** adds a `.claymind.json` file (or drop the file on the page).
- **Remove from scene** (main menu for the object you touched last, or the button in an object's material ring) takes that copy off the table with a 5-second Undo; **Clear scene** (press twice) removes every object placed from the Library. Neither ever changes the Library, unlike **Delete from Library** (the saved item, forever) and **Delete this creation** (what you are making), which are red.
- Pinned creations still come back to their spot after a reload (kept separately from the Library).
- Stored in this browser only (IndexedDB); no account, no upload.

## Play Kit (your own toys, Sets and table games; fully offline)
- **Add to Play Kit** (menu, or "+ Add current" in the Play Kit panel) puts the current creation in your toy box with a role guessed from its shape (board, piece, launcher, target, obstacle, container, other) and its measured size and mass. One creation can be in the Library and the Play Kit.
- **Play Kit** (menu or `O`) has three tabs. **Kit**: Place a toy on the table, Rename, change Role, Duplicate, Remove (Undo), Download kit / Import. **Sets**: "Save table as a Set" (positions relative to the table, which pieces are fixed, the game), Open, Rename, Delete (Undo). **Games**: Knock-down, Flick-and-pocket, Target throw, Tower balance, Marble run. Pick one, tap a part to choose which of your toys plays it (built-in shapes fill the rest), Play.
- While a Set or game is on the table the clay steps aside. The game panel shows the score and has **Edit / Play** (Edit pins every piece where you put it; Play lets physics run, boards, ramps and cups stay fixed), **Pause**, **Reset** (back exactly to the start), **Rules**, **Save Set** and **End** (the clay comes back).
- Hands: pinch to pick up and throw, flick a piece with a fast fingertip, push, stack. Mouse: drag a piece over the table and let go to throw it.
- Games are **Game Specs** (versioned JSON: roles, layout, zones, turns and rules made only of fixed triggers and actions) run by a deterministic rule engine; no code is ever run from a spec. Kit files are `.claymind.json` (format `claymind-kit`, up to 50 MB) and import through the same Import button.

## Download format (for game developers)
**Download** asks the licence, *Keep my rights* or *Anyone may use this (CC0)*, which is written into the GLB's `asset.copyright`, then the file:
- **`<name>.glb`**: binary glTF 2.0 for Unity, Unreal, Godot, Blender and three.js.
  - A root node named after the creation, with one child node per piece named `piece_<n>_<materialId>` (for example `piece_1_steel`).
  - One PBR material per piece, named after its material type, with base colour = the piece colour, plus roughness, metalness and opacity (glass uses alpha blending).
  - Painted pieces carry the paint as vertex colours (`COLOR_0`) on a white base colour.
  - Welded, indexed triangles; metres; Y-up; origin at the centre of the base.
  - Physics on the root node: `extras.claymind = { schemaVersion, name, pieces: [{ id, materialId, massKg, density, friction, restitution }], totalMassKg, centerOfMass: [x, y, z] }` (kg, kg/m3, metres in the model's frame).
- **`<name>.claymind.json`**: the full ClayMind project (pieces, paint, colliders, materials, colours) to import again; checked on import, at most 10 MB.

## Controls
- **Quest (hands):** pinch the clay and pull to stretch it · point your index finger into it to dent · open palm on it to smooth · both hands pinching away from the clay to rotate/scale · turn your **left palm up** for the tool menu (Bring to life, Shape, Add, Carve, Smooth, Paint, Eraser, Mirror, Undo, Redo, New piece, Material, Color, Join, Pin / Unpin, Play Kit, Library, Add to Library, Settings, Separate, Delete, New clay) and poke a button with your right index finger. **Bring to life** turns the sculpt into a real object that flies onto your right palm; turn the hand over to drop it, or pinch an object to pick it up and throw it. **Material** opens a ring of materials for the piece you touched last.
- **Browser:** drag on the clay = pull (Shape) or use the selected tool · Shift+drag = poke · drag empty space = turn · 1-4 tools · M mirror · Ctrl+Z / Ctrl+Y · **N = new piece** · **Enter = bring to life** · click a part of an object, then **Material** to change that part · drag an object to move it, **mouse wheel lifts it**, release to drop or throw · H debug HUD (`?debug`) · with `?devKgView`: G brain · B check beliefs · P mastery.
- **Pieces:** **New piece** (`N`) starts another piece in its own clay colour: the next Add stroke lays it down (e.g. a head on a handle). After Bring to life, touch a piece and press **Material** (`T`) to pick its material from the ring; mass, balance, friction, bounce and breaking follow. **Separate** (`K`) makes the touched piece its own object; **Join** (`J`) sticks the touched object to one touching it.
- **Colour and paint:** **Color** (`C`) opens the colour picker: pick a colour, then **Whole piece** colours the piece, or **Paint** (`5`) draws on the clay with your fingertip / mouse (**Eraser** `6`, brush size `[` `]`). Paint stays on the clay while you keep sculpting and carries over when it comes to life. Colour never changes the physics.
- **Room:** **Pin / Unpin** (`P`) fixes an object where it is (snapped onto the table); grabbing it unpins it. **Library** (`L`): see *Library and Download* above; pinned things come back to their spot when you return. **Play Kit** (`O`): pebbles, dominoes and a glass plate to play with. In the headset, pinch at a far object to grab it with a ray.
- **Settings** (`S`): reduced motion, high contrast, left-handed, one-handed menu, sound, the tutorial again, and Reset everything. The first time you start, a short tutorial card guides you from clay to a painted, pinned object.

## Phase 0 spike pages
- `/?spikes`: MR scene. Ball drop on the table (real plane on Quest, virtual elsewhere), pinch probe, impact/CCD probe, camera probe (`?camera=1`). Keys: B drop · F fast shot · N spawn 10 · R clear · C camera.
- `/spikes/sdf.html`: SDF sculpt benchmark (`?res=64` for 64³).
- `/spikes/hands.html`: MediaPipe webcam hand tracking.

## Layout
- `client/`: IWSDK + Vite + TypeScript app (`src/core`, `src/platform`, `src/sculpt`, `src/spikes`, `src/devtools`)
- `docs/`: KNOWN_LIMITS, PERF, IDEAS (more per phase)
- `server/`, `assets/`: arrive in Phases 2 and 4

> **Plan v4 (`docs/PLAN.md`, from 2026-10-10): no AI, fully offline.** The brain graph, Debug the Brain, Mastery and the AI layer described below are switched off for players (`?devKgView`, `?devAi` bring them back for development). Every piece starts as clay; the player picks materials.

## The brain (Phase 3)
After **Bring to life**, the AI's reasoning graph appears above the table (toggle: **Brain** in the menu, or `G`). Each prediction comes from the graph:
- **Cut a belief:** pinch (or mouse-drag) an edge's middle handle and pull it away.
- **Add a belief:** pinch-drag (or mouse-drag) from one node onto another.
- **Why?** Tap a prediction on the card; its reasoning path lights up step by step.
- **Undo edit / Reset brain / Overview** are on the card. The card shows what each edit changed, e.g. "bounces 67% → 0%".
- The brain is saved in the browser (IndexedDB) and survives reloads.

## Debug the Brain and Mastery (Phase 5)
- **Check beliefs** (menu, the agent panel's button, or `B`): the agent picks the belief about your object that is most worth testing, runs a real physics experiment on the table beside the clay, and shows each step. If the result contradicts a belief, the edge pulses red and the agent asks before removing it (or lowers its confidence if you keep it). The starting brain holds one deliberately wrong belief, "heavy things fall faster", so the first check shows this.
- If the material guess is unsure, the agent asks which material you meant.
- **Mastery** (menu or `P`): time to object, material guesses kept, beliefs fixed, experiments run and saved by memory, brain size, AI cache hits.

## AI layer (Phase 4, optional)
The game works fully offline: Bring to life always creates the object locally first. On top of that, the AI layer looks at the sculpt, names it, refines the material guess (the brain gains AI beliefs), and for raw sculpts swaps in a clean generated model, with progress on the object's label.

- **No server** (static build, judges): an in-browser mock with shipped sample models.
- **Local server:** see `server/README.md` (mock providers by default; Claude vision and fal.ai image-to-3D when keys are set). In dev the game finds it at `/api` automatically.
- URL options: `?ai=off|mock|server|auto`, `?aiUrl=https://…`. The **AI** button in the menu turns it on and off.
