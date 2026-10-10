# ClayMind plan v3: Clay -> AI understands -> real physics -> you talk to the AI

Adopted 2026-10-10 after Phase 5. Replaces the older add-on plans. The master prompt still holds the technical rules (IWSDK, Quest performance, hands-only, seated, offline fallback, code structure). If anything conflicts, this file wins.

Working rules: one step at a time; run it, test it, report in <= 10 lines (works / broken / frame time on Quest / changes from this plan and why / next), then wait. No features outside this file. Keep the app runnable. Hands-only, seated, no camera shake.

## 1. The product
1. Make things from clay with your hands. Pieces can be joined.
2. The AI understands what was made: what it is, its parts, each part's probable material.
3. A clean 3D object is made (offline: the sculpt or a template; online: AI image-to-3D polish).
4. Real physics per part material (mass, friction, bounce, strength), on the real table.
5. The player says how a thing should behave; the AI maps it to a fixed behavior list (section 5).
6. The AI discusses what it made ("base steel, top wood, right?"); the player agrees or corrects.
7. Internally a Physics Relations Graph (touches, supports, pushes) explains and predicts chains of contact.
8. The graph is never drawn for the player: only words, labels and numbers.

## 2. Scope
IN, in order: hand sculpting (done), multi-piece objects with per-piece materials, correct per-piece physics numbers, Physics Relations Graph, AI understanding + dialogue, words -> behavior, Predict then Test, polish.
OUT (ideas go to `IDEAS.md`): 3D graph visualization, Debug-the-Brain visuals, hinge/slide joints, challenges, mastery screen, training mini-game, Agent Exam, lobby/fight/multiplayer (Appendix A only if time remains), photo capture, SAM 3D, TRIBE v2, webcam/Android tiers, automatic splitting of one lump into pieces.

## 3. AI
- Closed multimodal models allowed for: looking at sculpt renders, naming, material per part, conversation, words -> behavior spec. One adapter: `describe`, `converse`, `parseBehavior`, optional `image2model`.
- Keys only on the server; per-session limits and a global spend cap; only sculpt renders and the player's own text are sent.
- The AI proposes, our code decides: strict JSON validated against schemas; physics numbers only from our tables and functions; the AI picks from our material table and behavior list.
- Offline fallback (required): shape rules + the player's past corrections for materials, canned dialogue, keyword behavior parsing. Never dead-ends.
- Judges: cached AI results for sample sculpts and a pre-filled player history.

## 4. Materials and physics
- `materials.json` with 8 player-facing materials: steel, stone, wood, rubber, plastic, glass, foam, clay. Each: density, friction, restitution, hardness, fragility, sound, look.
- A creation = pieces joined when touching; each piece has `materialId` + `confidence`.
- One pure function `computePhysicalProperties(assembly)`: per piece and total volume, mass, center of mass, inertia, support area. Physics setup and all player-facing text use it. Unit tests: two equal cubes steel vs wood (COM shifts to steel), an L shape, a pyramid.
- Havok via IWSDK; damage/breaking via `matchups.json` (material pair -> damage/friction multipliers, sounds).
- Real room: rests on table/floor, tips when COM leaves the support area, breaks above material limits (pre-made chunks + particles + sound).

## 5. Words -> behavior
Fixed list: `roll`, `slide`, `bounce`, `spin`, `wobble`, `stay-heavy-low`, `light-and-floaty`, `fragile`, `tough`. Each maps to concrete parameter changes within material limits. Outside the list: "I can't do that yet, closest option: ...". The AI says what it changed; every change can be undone.

## 6. Physics Relations Graph (internal)
Nodes: pieces/assemblies, real surfaces, props. Edges: `touches`, `supports`, `joined_to`, `pushes` (time, magnitude), `will_tip`. Uses: explain a chain after an event, predict before a test, pick the question most likely to be wrong. Predict then Test: Predict (drop/push/tilt) -> AI states prediction -> physics runs -> compare; if wrong, say why and offer a fix; corrections stored as examples.

## 7. Conversation
Small spatial panel by the object, large text, big buttons. Short messages; one question if any confidence < 0.6; quick replies "Yes", "Change material", "Why?", "Make it ...", "Predict"; "Why?" = 1-2 sentences; max 2 questions per creation; never blocks play. Learning: corrections saved as (shape features -> material) examples; nearest examples first, then rules, then the model. One honest line like "Learned: long thin pieces are usually steel for you."

## 8. Phases (deadline 18 Nov 2026 12:00 PST; feature freeze 13 Nov)
- 6a (~2 days, likely 1): spikes (section 4) + hide KG UI (`devKgView=false`).
- 6b (~4 days): multi-piece multi-material objects, `computePhysicalProperties`, matchups, breaking. Accept: stone-head/wood-handle hammer tips and hits differently from an all-wood hammer; tipping matches the computed COM.
- 7 (~5 days): Physics Relations Graph + Predict then Test. Accept: a three-body chain reaction explained correctly in words.
- 8 (~6 days): AI understanding + dialogue + words -> behavior, adapter, schemas, offline fallback, cached samples, local learning. Accept: sculpt, AI names it and assigns materials, player corrects one, says "make it bounce", result changes, also offline.
- 9 (~8 days): polish, onboarding (first five minutes), accessibility, 72 fps, judge profile + Reset.
- 10 (~7 days): submission (deploy, video < 3 min, README, Devpost, final Quest run).
- Never cut: per-piece materials with correct physics, AI dialogue with corrections, Predict then Test with chain explanation, offline fallback, onboarding, 72 fps.

## 9. Submission framing
"Sculpt with your hands; an AI understands your creation, applies the right material physics, explains chains of cause and effect, and learns from your corrections." No mind-reading or "trains a neural network" claims. Awards: Best Agentic Interaction, Boldest Original Concept, Best First Five Minutes.

## Appendix A (optional): Clay Fight vs Bot
Only after 6-9 pass. Bot lobby, 45-60 s build, ~50 cm arena plate, pinch-drag push / pull-back dash, damage from physics + matchups, "Check my agent" link. No multiplayer.

---

## Engineering amendments (Claude, 2026-10-10)
These do not add features; they decide how the plan is built with what exists.

1. **Multi-piece physics = one body.** IWSDK 1.0.1 allows one `PhysicsShape` per entity, has no constraints/joints, and exposes `PhysicsBody.centerOfMass` (Havok mass properties). So an assembly is one dynamic body: one convex hull of all pieces, total mass and center of mass from `computePhysicalProperties` (the hull's own mass/COM are overridden). Tipping then follows our computed COM exactly. Friction/restitution are per body: use the material of the piece touching the surface (re-chosen when the object rests in a new pose), behaviors adjust from there. Limit: a convex hull fills concave gaps (an L shape slides as its hull). Confirmed by the 6a spike before 6b relies on it.
2. **Contact events do not exist in IWSDK 1.0.1** (no collision callbacks in the worker protocol). Impacts are already inferred from velocity changes (`ImpactSystem`); `pushes` edges are inferred the same way plus proximity (A slowed while B, within contact distance, sped up in the same step). Support/touch edges come from geometry (bounding boxes + table height).
3. **No CCD flag is exposed.** Mitigation: throw speed cap (exists, 6 m/s), minimum piece thickness, and the 72 Hz step. Spike measures the tunnelling speed for thin pieces.
4. **Reuse, not rewrite.** The Phase 3-5 brain (graph + reasoner + seed knowledge) stays as the internal static knowledge and corrections store, hidden behind `devKgView`. The Phase 5 experiment runner becomes Predict then Test. The Phase 4 AI adapter gains `converse` and `parseBehavior`. `CanvasPanel` becomes the dialogue panel. Agent/Mastery panels are hidden, not deleted.
5. **Materials 12 -> 8 player-facing.** Today: ceramic, glass, steel, aluminium, wood, plastic, rubber, stone, clay, foam, cloth, paper. Removed from play in 6b: ceramic -> glass (mug/vase priors), aluminium -> steel, cloth -> foam, paper -> foam; saved creations are migrated with that map.
6. **Pieces UX.** "New piece" starts another lump next to the current one; touching pieces join. Up to 4 pieces, each a smaller SDF grid (32^3) so meshing cost stays near today's single 48^3 grid.
7. **Text input in VR is hard** (no keyboard inside an immersive session on Quest Browser). Quick-reply buttons are the main path; free text works in the browser; voice (Web Speech API) is checked on Quest in Phase 8 and is optional.
8. **Frame time on Quest** can only be reported when the owner runs a Quest build; until then each report says "not measured on device".
