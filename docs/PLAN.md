# CLAYMIND V4: sculpt + material + color + paint + real physics (NO AI)

> This file REPLACES CLAYMIND_SIMPLE_V3.md and every older ClayMind plan. Keep MASTER_PROMPT_CLAYMIND.md only for the technical rules (IWSDK, Quest performance, hands-only, seated, code structure). If anything conflicts, THIS FILE WINS.
> Working rules: ONE step at a time. After each step run it, test it, report in <= 10 lines (works / broken / frame time on Quest / what changed / next) and wait. Do NOT add features that are not in this file (put ideas in `IDEAS.md`). Keep the app runnable. Hands-only, seated, no camera shake. Phase 5 is done; continue from Phase 6a.

## 1. Product in 6 lines
1. Sculpt clay with bare hands. Any shape. Take as many lumps ("pieces") as you like; each piece is its own clay.
2. Every piece has its own **material** (steel, stone, wood, rubber, plastic, glass, foam, clay), picked by the player with one tap.
3. Every piece has its own **color**, and the player can **draw/paint on its surface** with a brush (fingertip).
4. Pieces can be **joined** (stick together) or **separated**.
5. **Real physics** from material + shape: weight, center of mass, friction, bounce, tipping, breaking, sound. Color and paint are looks only.
6. Place it in the room: grab, distance grab, put on table/floor/shelf, **pin** it, or **unpin** and play (throw, roll, stack, knock down). Save to a Library.

## 2. Scope
**REMOVED (keep old code behind flags, do not delete code other modules use):** all AI (describe adapter, Function Packs, cloud calls, keys), Knowledge Graph and every graph view, Predict then Test, dialogue, challenges, mastery, fight/multiplayer, real-photo capture, SAM 3D, TRIBE v2.
**KEPT:** sculpting, the 8 materials, `computePhysicalProperties`, matchups/breaking, offline-only (no network needed at all).
**NEW:** per-piece material picker, per-piece color, surface painting, join/separate, room placement + pin + Library, Play Kit.
No network = no keys, no cost, nothing to break for judges.

## 3. Pieces, materials, color
- `Piece { id, sdf, materialId, color, paint }`. A creation = pieces + joints.
- `materials.json`: steel, stone, wood, rubber, plastic, glass, foam, clay (ceramic = stone). Each has density, friction, restitution, hardness, fragility, sound set, PBR look (roughness/metalness).
- **Material picker:** radial menu on a piece (look at it/touch it, palm-up hand opens it), big targets >= 3 cm, one tap. New pieces default to `clay`. Show a small chip: "Stone - heavy, fragile".
- **Color picker:** a hue ring + lightness bar + 8 quick swatches, applies to the whole piece. Color multiplies the material's PBR look (steel stays shiny, rubber stays matte).
- **Never** let color change physics.

## 4. Painting (draw on the clay)
- Store color **in the sculpt data**: an RGB value per voxel/SDF cell (or per vertex of the extracted mesh) so paint follows the shape when the player sculpts more.
- Brush: fingertip touching the surface paints; size by a thumb-index pinch slider (min 3 mm, max 3 cm); colors from the picker; **Eraser** mode restores the piece color. Stroke throttled to the frame budget; update only dirty chunks of the mesh.
- Undo/redo for sculpt AND paint (last 20 strokes).
- If vertex color on the extracted mesh is too slow on Quest, fall back to a per-piece low-res 3D color texture (e.g. 64^3) and sample it in the shader. Record the result in `docs/KNOWN_LIMITS.md`.

## 5. Physics (the real point)
- ONE pure function `computePhysicalProperties(assembly)`: per piece and total: volume, mass (volume x density), center of mass, inertia, support area on the table. Physics setup, the info chip and tipping all use this output. Unit-test it (two equal cubes steel vs wood shift COM toward steel; an L shape; a pyramid).
- Havok (IWSDK): one body per assembly, one convex shape per piece with its own density/friction/restitution. Pieces touching beyond a threshold are joined with fixed joints (compound body); a **Separate** button breaks the joint.
- **Concave pieces (cups, bowls):** pinned/static = TriMesh collider (static only in Havok); dynamic = **compound of boxes built from the voxel grid** (greedy merge, cap about 40 boxes) or convex parts. Switch on pin/unpin.
- `matchups.json` (material pair -> damage/friction multipliers, sound). Breaking: when the impulse exceeds the limit, the piece chips into pre-made chunks + particles + sound by material.
- Real room: rests on the real table/floor (planes or mesh as static colliders), tips when COM leaves the support area. Budget: about 10 dynamic bodies plus pebbles, sleeping on.
- **Play Kit** (procedural): about 10 pebble balls, a small domino tower, a target plate, spawned from the wrist menu, so every creation has something to interact with.

## 6. Room placement (hands-only, seated)
- One-hand grab (kinematic while held, velocity transferred on release); **distance grab** with a ray for far spots.
- **Pin/Unpin** (wrist menu or a ring on the object): pinned = static; unpinned = live physics. Surfaces from plane/mesh detection; soft snap within about 3 cm; contact shadow always.
- **Persistence:** save each creation (sculpt + materials + colors + paint + pose) in IndexedDB. Pinned objects use an anchor if the spike says anchors persist; otherwise save the pose relative to the table plane and show a "Re-place" button. Library shelf with thumbnails; pinch-drag brings one back.
- Comfort: never move or shake the player's view.

## 7. UI
- **Wrist menu (palm up):** New piece, Material, Color, Paint/Eraser, Join/Separate, Pin/Unpin, Play Kit, Library, Undo/Redo, Settings.
- One accent colour, one font (SDF text, >= 2.5 cm tall at 1 m), targets >= 3 cm, hover glow + tick, press click, sound for every action, no flat grey materials in the final build.
- **First five minutes (no text wall):** pinch Start -> a clay lump appears on the real table -> sculpt -> tap Material and Color -> paint a pattern -> drop it / pin it on a shelf. Target: a finished, painted, placed object in 2 minutes.
- Accessibility: high contrast, left/right swap, one-handed option, reduced motion, no flashing above 3 Hz.

## 8. Phases (today 10 Oct 2026; deadline 18 Nov 2026 12:00 PST; freeze 13 Nov)
- **6a (11-12 Oct): spikes**, record in `docs/KNOWN_LIMITS.md`: (a) several shapes with different material parameters on one body (child entities / Havok API / separate bodies + fixed constraints as fallbacks); (b) contact impulse events + CCD; (c) compound-of-boxes cup holding about 10 pebbles at 72 fps; (d) anchor persistence in Quest Browser; (e) distance grab of a physics body; (f) vertex-color vs 3D-texture painting cost on Quest. Hide all graph/AI UI; confirm Phase 5 still passes.
- **6b (13-16 Oct): multi-piece, multi-material** with `computePhysicalProperties`, joints, matchups, breaking, material picker. *Accept:* a hammer with a stone head and a wooden handle hits and tips differently from an all-wood one.
- **7 (17-22 Oct): color + painting.** Color picker, brush, eraser, paint stored in sculpt data, undo/redo. *Accept:* paint a pattern on a piece, keep sculpting it, paint stays on the surface; 72 fps.
- **8 (23-28 Oct): room placement.** Grab, distance grab, pin/unpin, surfaces, Library, persistence, Play Kit. *Accept:* make a cup, paint it, pin it on a real table edge, reload, find it again (or one-tap Re-place); pebbles pour into it.
- **9 (29 Oct-5 Nov): polish.** PBR looks, contact shadows, FX and sound by material, UI, onboarding, accessibility, 72 fps pass, pre-made sample creations + Reset button.
- **Buffer 6-9 Nov:** bug fixing, more Play Kit pieces. Nothing new after 9 Nov.
- **10-13 Nov:** bug fixing, public HTTPS deploy, test on a real Quest, freeze 13 Nov.
- **14-18 Nov:** demo video (< 3 min, best moment first), README (setup < 10 steps), Devpost text, final run.
- Cut order if late: more Play Kit pieces -> paint eraser/size slider -> pinned-pose persistence (keep Library). **Never cut:** per-piece materials with correct physics, color, painting, placing/pinning, onboarding, 72 fps.

## 9. Honest limits (write in `docs/KNOWN_LIMITS.md`)
Concave dynamic colliders are approximations; Havok TriMesh is static only; anchor persistence in Quest Browser is unverified; painting resolution is limited by the Quest budget; a single lump is one piece (no automatic splitting); real objects do not move when hit; iOS Safari has no WebXR.

## 10. Submission framing
Track: Productivity (creative tool) or Gaming (sandbox). Aim at Boldest Original Concept, Best First Five Minutes, Best Reason to Come Back (your library of creations lives in your room). Pitch: "Sculpt, paint and build with real materials in your own room. What you make is heavy, bouncy, fragile or slippery for real." No AI claims.

---

## Engineering notes (Claude, 2026-10-10, after the v4 Phase 6a spikes)
How v4 is built with what IWSDK 1.0.1 offers. No features added.

1. **Compound bodies and collision events need a small IWSDK extension.** IWSDK's physics component allows one shape per body, no joints and no contact events, but the Havok engine it ships has all three (container shapes with per-child material, constraints, collision events with impulse). ClayMind swaps IWSDK's worker-side runtime for an extended one (`src/physics/runtime/physics-runtime-ext.ts`) through a tiny Vite plugin (`vite.config.ts`); IWSDK's main-thread PhysicsSystem is untouched. Proven in dev, in the production build and in the live page (6a). Phase 6b-v4 adds to it: compound shapes (one child per piece, own density/friction/restitution; concave pieces as up to ~40 boxes) and collision events (with impulse) posted back to the main thread.
2. **Join / Separate = one compound body vs separate bodies.** A joined creation is one body whose children are its pieces (no joint solver needed for "stick together"); Separate rebuilds the piece as its own body. Havok fixed constraints stay available if a hinge-like case appears later.
3. **Until 6b-v4 lands** the game keeps the 6b one-hull body with our centre of mass (accepted hammer test).
4. **Painting = colour per sculpt-grid sample**, copied to vertex colours at re-mesh (the same path as the piece labels): ~0.6 ms per dab on desktop (worker). Paint detail is limited by the grid (~5 mm at 48^3), so the 3 mm minimum brush is effectively ~5 mm.
5. **No AI, no network:** the AI system, template replacement and material guessing are off (`?devAi` restores them for development). Every piece starts as clay. The brain/agent/mastery views stay off (`?devKgView`).
6. **Frame time on Quest** is reported as "not measured" until the owner runs a Quest build.

