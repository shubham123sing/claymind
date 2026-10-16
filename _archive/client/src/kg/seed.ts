/**
 * Builds the initial brain: domain knowledge from kg/seed/knowledge.json,
 * material properties generated from the material table, and one Concept per
 * template (with features/properties from its tags). All edges are `prior`
 * and fully editable by the user.
 */
import { MATERIALS } from '../materials/materials.js';
import { TEMPLATES } from '../objects/templates.js';
import type { KnowledgeGraph } from './graph.js';
import type { NodeType, Relation } from './schema.js';
import knowledge from './seed/knowledge.json';

const K = knowledge as unknown as {
  properties: Record<string, string>;
  behaviors: Record<string, string>;
  features: Record<string, string>;
  edges: [string, Relation, string, number, string][];
  tagMap: Record<string, string>;
  planted: { edge: string; truth: string }[];
};

export const PLANTED_BELIEFS = K.planted;

export function nodeTypeOf(id: string): NodeType {
  const p = id.split(':')[0];
  return (
    ({ prop: 'Property', beh: 'Behavior', feat: 'ShapeFeature', mat: 'Material', concept: 'Concept', cre: 'Creation', ctx: 'Context', chal: 'Challenge' } as const)[
      p as 'prop'
    ] ?? 'Context'
  );
}

/** Human label for a node id from the seed tables. */
export function seedLabel(id: string): string {
  const [p, key] = id.split(':');
  if (p === 'prop') return K.properties[key] ?? key;
  if (p === 'beh') return K.behaviors[key] ?? key;
  if (p === 'feat') return K.features[key] ?? key;
  return key;
}

export function seedGraph(g: KnowledgeGraph): void {
  g.batch('system', () => {
    for (const [k, label] of Object.entries(K.properties)) g.ensureNode(`prop:${k}`, 'Property', label);
    for (const [k, label] of Object.entries(K.behaviors)) g.ensureNode(`beh:${k}`, 'Behavior', label);
    for (const [k, label] of Object.entries(K.features)) g.ensureNode(`feat:${k}`, 'ShapeFeature', label);
    for (const [from, rel, to, conf, domain] of K.edges)
      g.setEdge(from, rel, to, { confidence: conf, source: 'prior', evidence: [`seed:${domain}`] });

    // materials: properties derived from the physical table
    for (const m of MATERIALS) {
      const id = `mat:${m.id}`;
      g.ensureNode(id, 'Material', m.name, { color: m.visual.color });
      if (m.fragility) g.setEdge(id, 'has_property', 'prop:fragile', { confidence: 0.9, source: 'prior', evidence: ['materials.json:fragility'] });
      if (m.restitution >= 0.6) g.setEdge(id, 'has_property', 'prop:bouncy', { confidence: 0.9, source: 'prior', evidence: ['materials.json:restitution'] });
      if (m.hardness >= 0.7) g.setEdge(id, 'has_property', 'prop:hard', { confidence: 0.85, source: 'prior', evidence: ['materials.json:hardness'] });
      g.setEdge(id, 'has_property', m.density > 1000 ? 'prop:dense' : 'prop:buoyant', { confidence: 0.95, source: 'prior', evidence: ['materials.json:density'] });
      if (m.tags.includes('soft')) g.setEdge(id, 'has_property', 'prop:flexible', { confidence: 0.8, source: 'prior', evidence: ['materials.json:tags'] });
    }

    // concepts from the template library
    for (const t of TEMPLATES) {
      const id = `concept:${t.id}`;
      g.ensureNode(id, 'Concept', t.name, { category: t.category });
      for (const tag of t.tags) {
        const target = K.tagMap[tag];
        if (!target) continue;
        const rel: Relation = target.startsWith('feat:') ? 'has_feature' : 'has_property';
        g.setEdge(id, rel, target, { confidence: 0.85, source: 'prior', evidence: [`template:${t.id}`] });
      }
    }
  });
}
