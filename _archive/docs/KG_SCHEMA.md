# Knowledge Graph schema (v1)

Source of truth: `client/src/kg/schema.ts` (`KG_SCHEMA_VERSION = 1`). Saved snapshots carry `schemaVersion`; upgrades live in `client/src/kg/migrations.ts` and are tested in `tests/unit/kg.test.ts`.

## Nodes
`KGNode { id, type, label, props, createdAt }`

| type | id prefix | examples | origin |
|---|---|---|---|
| Creation | `cre:` | `cre:c_…` (one per baked object, last 20 kept) | Bring to life |
| Concept | `concept:` | `concept:mug`, `concept:ball` | one per template |
| Material | `mat:` | `mat:glass` | `materials.json` |
| ShapeFeature | `feat:` | hollow, round, flat, thin-walled, tall, has a hole, long | `kg/seed/knowledge.json` |
| Property | `prop:` | fragile, bouncy, denser/lighter than water, heavy, can hold liquid, rolls easily, stackable, flexible, hard | seed |
| Behavior | `beh:` | breaks when dropped, bounces, sinks, floats, rolls, holds liquid, stacks, falls faster | seed |
| Context / Challenge | `ctx:` / `chal:` | reserved for Phases 5-6 | — |

## Edges
`KGEdge { id = "from|relation|to", from, to, relation, confidence 0..1, source, status, evidence[], updatedAt }`

| relation | meaning | typical from → to |
|---|---|---|
| is_a | identity / category | Creation → Concept |
| made_of | material | Creation/Concept → Material |
| has_feature | shape feature | Creation/Concept → ShapeFeature |
| has_property | property | Material/Concept/Creation → Property |
| implies | feature → property | ShapeFeature → Property |
| causes | property/feature → behaviour | Property/ShapeFeature → Behavior |
| contradicts | weakens the weaker of two properties held together | Property → Property |
| similar_to, learned_from | reserved (Phases 4-5) | |
| has_behavior | **derived only** (reasoner output) | Creation → Behavior |

- `source`: `prior` (seed / estimator), `measurement` (shape descriptor, mass), `vlm` (Phase 4), `user` (edits, weighted highest), `experiment` (Phase 5).
- `status`: `active`, `disputed` (counts at half confidence; pulses red), `rejected` (cut by the user, or removed by the agent after the user approved: ignored by the reasoner, shown faded so it can be undone).

## Rules (`client/src/kg/rules/core.json`)
Generic patterns only; the domain knowledge is in editable edges.

| id | if | then | factor |
|---|---|---|---|
| material-property | X made_of M, M has_property P | X has_property P | 1 |
| concept-property | X is_a C, C has_property P | X has_property P | 0.95 |
| concept-feature | X is_a C, C has_feature F | X has_feature F | 0.9 |
| feature-property | X has_feature F, F implies P | X has_property P | 1 |
| property-behavior | X has_property P, P causes B | X has_behavior B | 1 |
| feature-behavior | X has_feature F, F causes B | X has_behavior B | 1 |

Derived confidence = factor × product of the premise confidences. The strongest derivation of each fact is kept, and its premise chain is the **reasoning path** shown by "Why?". Then `contradicts` weakens the weaker property (`× (1 − strong × contradiction)`) and behaviours are re-derived.

## Change log & undo
Every mutation is recorded (`KGChange { kind, before, after, group, by }`). User edits (cut, connect, material correction) form undo groups. "Undo edit" reverts the latest user group; system changes (new creations) are not undone by it. The log is persisted (last 300 changes).

## Planted belief (demo)
`prop:heavy —causes→ beh:falls_faster` (0.75) is deliberately wrong. Phase 5's agent tests it with a drop experiment and asks the user to fix it (see `planted` in `kg/seed/knowledge.json`).
