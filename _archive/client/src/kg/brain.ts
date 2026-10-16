/**
 * The AI's visible "brain": Knowledge Graph + rules + reasoner, plus the
 * operations the game and the user perform on it. The answers shown to the
 * user (predictions + reasoning paths) always come from the reasoner over the
 * graph, so editing the graph truly changes them.
 */
import type { DescribeResult } from '../ai/types.js';
import type { Creation } from '../objects/creation.js';
import { KnowledgeGraph } from './graph.js';
import { factId, reason, ReasoningResult, Rule } from './reasoner.js';
import core from './rules/core.json';
import { nodeTypeOf, seedGraph } from './seed.js';
import type { KGEdge, NodeType, Relation } from './schema.js';

export const RULES: Rule[] = (core as unknown as { rules: Rule[] }).rules;

export interface Prediction {
  behaviorId: string;
  label: string;
  confidence: number;
  /** Stored edge ids justifying it, in reasoning order. */
  path: string[];
  rules: string[];
}

/** Relation used when the user connects node A -> node B, by node types. */
const CONNECT: Partial<Record<NodeType, Partial<Record<NodeType, Relation>>>> = {
  Creation: { Material: 'made_of', Concept: 'is_a', ShapeFeature: 'has_feature', Property: 'has_property' },
  Concept: { Material: 'made_of', Property: 'has_property', ShapeFeature: 'has_feature', Concept: 'is_a' },
  Material: { Property: 'has_property' },
  ShapeFeature: { Property: 'implies', Behavior: 'causes' },
  Property: { Behavior: 'causes', Property: 'contradicts' },
};

export function connectRelation(from: NodeType, to: NodeType): Relation | null {
  return CONNECT[from]?.[to] ?? null;
}

export class Brain {
  readonly graph = new KnowledgeGraph();
  private cache: { version: number; result: ReasoningResult } | null = null;

  seedIfEmpty(): void {
    if (this.graph.nodes.size === 0) seedGraph(this.graph);
  }

  reset(): void {
    this.graph.clear();
    seedGraph(this.graph);
  }

  /** Reasoning over the current graph (cached per graph version). */
  reasoning(): ReasoningResult {
    if (!this.cache || this.cache.version !== this.graph.version) {
      this.cache = { version: this.graph.version, result: reason(this.graph.activeEdges(), RULES) };
    }
    return this.cache.result;
  }

  predictions(nodeId: string): Prediction[] {
    const r = this.reasoning();
    const out: Prediction[] = [];
    for (const f of r.facts.values()) {
      if (f.s !== nodeId || f.r !== 'has_behavior') continue;
      out.push({
        behaviorId: f.o,
        label: this.graph.node(f.o)?.label ?? f.o,
        confidence: f.confidence,
        path: r.path(f.id),
        rules: r.rulesFor(f.id),
      });
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  }

  /** Derived + stored properties of a node (for the info card). */
  properties(nodeId: string): { id: string; confidence: number }[] {
    const r = this.reasoning();
    return [...r.facts.values()]
      .filter((f) => f.s === nodeId && f.r === 'has_property')
      .map((f) => ({ id: f.o, confidence: f.confidence }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ------------- creations -------------

  /** Add a creation and what was observed/estimated about it. */
  addCreation(c: Creation): string {
    const id = `cre:${c.id}`;
    const g = this.graph;
    g.batch('system', () => {
      g.ensureNode(id, 'Creation', c.name, { creationId: c.id, sizeCm: c.sizeCm, massKg: c.massKg, source: c.source });
      const concept = c.templateId ?? (c.bestGuess && c.bestGuess.similarity >= 0.4 ? c.bestGuess.id : null);
      if (concept) {
        const conf = c.templateId ? c.matchScore : c.bestGuess!.similarity;
        g.setEdge(id, 'is_a', `concept:${concept}`, { confidence: conf, source: 'measurement', evidence: [`shape match ${(conf * 100).toFixed(0)}%`] });
      }
      g.setEdge(id, 'made_of', `mat:${c.materialId}`, { confidence: c.materialConfidence, source: 'prior', evidence: ['material estimator'] });
      for (const [feat, conf] of shapeFeatures(c)) g.setEdge(id, 'has_feature', feat, { confidence: conf, source: 'measurement', evidence: ['shape descriptor'] });
      if (c.massKg > 0.5) g.setEdge(id, 'has_property', 'prop:heavy', { confidence: Math.min(1, c.massKg / 1.5 + 0.4), source: 'measurement', evidence: [`${(c.massKg * 1000).toFixed(0)} g`] });
      else if (c.massKg < 0.1) g.setEdge(id, 'has_property', 'prop:light', { confidence: 0.9, source: 'measurement', evidence: [`${(c.massKg * 1000).toFixed(0)} g`] });
      this.pruneCreations(20);
    });
    c.kgNodeIds = [id];
    return id;
  }

  /** The user picked a material: replaces the estimate (user edges weigh most). */
  setCreationMaterial(creationId: string, materialId: string): void {
    const id = `cre:${creationId}`;
    if (!this.graph.node(id)) return;
    const g = this.graph;
    g.batch('user', () => {
      for (const e of g.outgoing(id)) if (e.relation === 'made_of' && e.to !== `mat:${materialId}`) g.setEdge(e.from, e.relation, e.to, { ...e, status: 'rejected', source: 'user' });
      g.setEdge(id, 'made_of', `mat:${materialId}`, { confidence: 1, source: 'user', evidence: ['user picked material'] });
    });
  }

  /**
   * The vision model's description becomes `vlm`-sourced beliefs: what it is
   * (an existing concept, or a new one it named) and what it is probably made of.
   * The estimate edges stay; user edges always outrank both (see setCreationMaterial).
   */
  addVlmFacts(creationId: string, r: DescribeResult): void {
    const id = `cre:${creationId}`;
    if (!this.graph.node(id)) return;
    const g = this.graph;
    g.batch('system', () => {
      const node = g.node(id);
      if (node && r.confidence >= 0.5) node.label = r.name;
      const concept = `concept:${r.category.replace(/[^a-z0-9_-]/g, '_')}`;
      g.ensureNode(concept, 'Concept', r.name, { from: 'vlm' });
      g.setEdge(id, 'is_a', concept, { confidence: r.confidence, source: 'vlm', evidence: [`vision model: ${r.name}`] });
      for (const m of r.material.slice(0, 2)) {
        const mat = `mat:${m.name}`;
        if (!g.node(mat)) continue;
        const existing = g.edge(`${id}|made_of|${mat}`);
        if (existing?.source === 'user') continue;
        g.setEdge(id, 'made_of', mat, { confidence: m.prob, source: 'vlm', evidence: [`vision model ${(m.prob * 100).toFixed(0)}%`] });
      }
    });
  }

  /** The AI picked a material (combined estimate): weaker than a user choice, never rejects other options. */
  setCreationMaterialByAi(creationId: string, materialId: string, confidence: number): void {
    const id = `cre:${creationId}`;
    if (!this.graph.node(id)) return;
    const g = this.graph;
    if (g.outgoing(id).some((e) => e.relation === 'made_of' && e.source === 'user' && e.status === 'active')) return;
    g.batch('system', () => {
      for (const e of g.outgoing(id))
        if (e.relation === 'made_of' && e.to !== `mat:${materialId}` && e.status === 'active') g.setEdge(e.from, e.relation, e.to, { ...e, confidence: e.confidence * 0.5 });
      g.setEdge(id, 'made_of', `mat:${materialId}`, { confidence, source: 'vlm', evidence: ['local estimate + vision model'] });
    });
  }

  private pruneCreations(keep: number): void {
    const cres = [...this.graph.nodes.values()].filter((n) => n.type === 'Creation').sort((a, b) => a.createdAt - b.createdAt);
    for (const n of cres.slice(0, Math.max(0, cres.length - keep))) this.graph.removeNode(n.id);
  }

  // ------------- user edits -------------

  /** Cut an edge: the user says this belief is wrong. Undoable. */
  cutEdge(edgeId: string): KGEdge | null {
    const e = this.graph.edge(edgeId);
    if (!e || e.status === 'rejected') return null;
    let out: KGEdge | null = null;
    this.graph.batch('user', () => {
      out = this.graph.setEdge(e.from, e.relation, e.to, { confidence: e.confidence, source: 'user', status: 'rejected', evidence: [...e.evidence, 'cut by user'] });
    });
    return out;
  }

  /** Connect A -> B with the relation implied by their types. Returns null if they can't be linked. */
  connect(fromId: string, toId: string): KGEdge | null {
    const a = this.graph.node(fromId), b = this.graph.node(toId);
    if (!a || !b || a.id === b.id) return null;
    const rel = connectRelation(a.type, b.type);
    if (!rel) return null;
    let out: KGEdge | null = null;
    this.graph.batch('user', () => {
      out = this.graph.setEdge(a.id, rel, b.id, { confidence: 1, source: 'user', evidence: ['connected by user'] });
    });
    return out;
  }

  // ------------- agent / experiments -------------

  /** An experiment contradicted this belief: mark it disputed (counts at half confidence, pulses red). */
  disputeEdge(edgeId: string, evidence: string): void {
    const e = this.graph.edge(edgeId);
    if (!e || e.status === 'rejected') return;
    this.graph.batch('system', () => this.graph.setEdge(e.from, e.relation, e.to, { ...e, status: 'disputed', evidence: [...e.evidence, evidence] }));
  }

  /**
   * The user decided about a disputed belief. wrong = true: reject it (undoable,
   * source becomes `experiment`); false: keep it, a little less sure.
   */
  resolveDispute(edgeId: string, wrong: boolean): void {
    const e = this.graph.edge(edgeId);
    if (!e) return;
    this.graph.batch('user', () => {
      if (wrong) this.graph.setEdge(e.from, e.relation, e.to, { ...e, status: 'rejected', source: 'experiment', evidence: [...e.evidence, 'removed after an experiment (approved by user)'] });
      else this.graph.setEdge(e.from, e.relation, e.to, { ...e, status: 'active', confidence: e.confidence * 0.7, evidence: [...e.evidence, 'kept by user despite an experiment'] });
    });
  }

  /** An experiment agreed with these beliefs: a little more confident. */
  confirmEdges(edgeIds: string[], evidence: string): void {
    this.graph.batch('system', () => {
      for (const id of edgeIds) {
        const e = this.graph.edge(id);
        if (!e || e.status === 'rejected' || e.from.startsWith('cre:')) continue;
        this.graph.setEdge(e.from, e.relation, e.to, { ...e, status: 'active', confidence: Math.min(1, e.confidence + 0.1), evidence: [...e.evidence, evidence] });
      }
    });
  }

  /** Add (or restore) a belief an experiment supports, after user approval. */
  addLearnedEdge(from: string, relation: Relation, to: string, evidence: string): KGEdge | null {
    if (!this.graph.node(from) || !this.graph.node(to)) return null;
    let out: KGEdge | null = null;
    this.graph.batch('user', () => {
      out = this.graph.setEdge(from, relation, to, { confidence: 0.9, source: 'experiment', status: 'active', evidence: [evidence] });
    });
    return out;
  }

  undo(): boolean {
    return this.graph.undo('user');
  }

  canUndo(): boolean {
    return this.graph.canUndo('user');
  }

  /** Confidence of a single stored or derived fact (0 if absent). */
  confidenceOf(s: string, r: Relation, o: string): number {
    return this.reasoning().facts.get(factId(s, r, o))?.confidence ?? 0;
  }
}

/** Shape features observed on a creation (measurement source). */
export function shapeFeatures(c: Creation): [string, number][] {
  const d = c.descriptor;
  const out: [string, number][] = [];
  if (d.openTop >= 0.55) out.push(['feat:hollow', Math.min(1, 0.5 + d.openTop / 2)]);
  if (d.aspect > 0.75 && d.aspect < 1.3 && d.elong > 0.85 && d.fill > 0.4 && d.fill < 0.66) out.push(['feat:round', 0.9]);
  if (d.aspect < 0.3) out.push(['feat:flat', 0.85]);
  if (d.openTop >= 0.55 && d.fill < 0.3) out.push(['feat:thin', 0.7]);
  if (d.aspect > 1.5) out.push(['feat:tall', 0.85]);
  if (d.holes >= 1) out.push(['feat:ring', 0.8]);
  if (d.elong < 0.35) out.push(['feat:long', 0.85]);
  return out;
}

export { nodeTypeOf };
