import { describe, expect, it } from 'vitest';
import { Brain, connectRelation } from '../../src/kg/brain';
import { KnowledgeGraph } from '../../src/kg/graph';
import { reason } from '../../src/kg/reasoner';
import type { Creation } from '../../src/objects/creation';

function creation(over: Partial<Creation> = {}): Creation {
  return {
    schemaVersion: 1, id: 'c1', createdAt: 0, name: 'Mug', category: 'container', source: 'template', templateId: 'mug',
    matchScore: 0.85, bestGuess: { id: 'mug', name: 'Mug', similarity: 0.85 }, materialId: 'ceramic', materialConfidence: 0.65,
    materialGuesses: [], massKg: 0.3, sizeCm: [11, 10, 8], volumeCm3: 130, timeToObject: 0.1, kgNodeIds: [],
    descriptor: { aspect: 0.9, elong: 0.78, fill: 0.2, openTop: 0.9, holes: 1, profile: [1, 1, 1, 1, 1], angle: 0, center: [0, 0, 0], extents: [0.1, 0.1, 0.08], volume: 1e-4 },
    ...over,
  };
}

const pred = (b: Brain, id: string, beh: string) => b.predictions(id).find((p) => p.behaviorId === `beh:${beh}`);

describe('reasoner (golden paths)', () => {
  it('a ceramic mug breaks when dropped: creation -> ceramic -> fragile -> breaks', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation());
    const p = pred(b, id, 'breaks_when_dropped')!;
    expect(p).toBeTruthy();
    expect(p.path).toEqual([
      'cre:c1|made_of|mat:ceramic',
      'mat:ceramic|has_property|prop:fragile',
      'prop:fragile|causes|beh:breaks_when_dropped',
    ]);
    // 0.65 (material estimate) × 0.9 (ceramic is fragile) × 0.85 (fragile causes breaking)
    expect(p.confidence).toBeCloseTo(0.65 * 0.9 * 0.85, 5);
    expect(p.rules).toEqual(['material-property', 'property-behavior']);
  });

  it('mugs hold liquid (via being hollow) and sink (ceramic is denser than water)', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation());
    expect(pred(b, id, 'holds_liquid')!.confidence).toBeGreaterThan(0.6);
    expect(pred(b, id, 'sinks')).toBeTruthy();
    expect(pred(b, id, 'floats')).toBeUndefined();
  });

  it('cutting an edge changes the conclusion; undo restores it', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation());
    const before = pred(b, id, 'breaks_when_dropped')!.confidence;
    b.cutEdge('mat:ceramic|has_property|prop:fragile');
    const after = pred(b, id, 'breaks_when_dropped');
    // the only remaining path is the weak "thin-walled implies fragile" one
    expect(after?.confidence ?? 0).toBeLessThan(before * 0.6);
    expect(after?.path ?? []).not.toContain('mat:ceramic|has_property|prop:fragile');
    expect(b.undo()).toBe(true);
    expect(pred(b, id, 'breaks_when_dropped')!.confidence).toBeCloseTo(before, 6);
  });

  it('connecting nodes adds a user belief with the type-implied relation', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation({ id: 'c2', materialId: 'steel', materialConfidence: 0.8 }));
    expect(pred(b, id, 'bounces')).toBeUndefined();
    const e = b.connect('mat:steel', 'prop:bouncy')!;
    expect(e.relation).toBe('has_property');
    expect(e.source).toBe('user');
    expect(pred(b, id, 'bounces')!.confidence).toBeCloseTo(0.8 * 1 * 0.9, 5);
    expect(connectRelation('Behavior', 'Material')).toBeNull();
  });

  it('a user material correction outweighs the estimate', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation({ materialId: 'plastic', materialConfidence: 0.5 }));
    expect(pred(b, id, 'breaks_when_dropped')?.confidence ?? 0).toBeLessThan(0.4);
    b.setCreationMaterial('c1', 'glass');
    expect(pred(b, id, 'breaks_when_dropped')!.confidence).toBeCloseTo(0.9 * 0.85, 5);
    expect(b.confidenceOf(id, 'made_of', 'mat:plastic')).toBe(0); // rejected
  });

  it('flexible contradicts fragile: a rubber object is not predicted to shatter', () => {
    const b = new Brain();
    b.seedIfEmpty();
    // a thin-walled rubber bowl: "thin implies fragile" vs "rubber is flexible"
    const id = b.addCreation(creation({ id: 'c3', name: 'Bowl', templateId: 'bowl', materialId: 'rubber', materialConfidence: 0.9 }));
    const p = pred(b, id, 'breaks_when_dropped');
    expect(p?.confidence ?? 0).toBeLessThan(0.15);
    expect(p?.path ?? []).toContain('prop:flexible|contradicts|prop:fragile');
  });

  it('heavy creations get the planted (wrong) belief "falls faster"', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(creation({ id: 'c4', massKg: 1.2, materialId: 'steel', materialConfidence: 0.9 }));
    expect(pred(b, id, 'falls_faster')).toBeTruthy();
  });
});

describe('graph store', () => {
  it('snapshot round-trips and undo only touches user groups', () => {
    const g = new KnowledgeGraph();
    g.ensureNode('a', 'Property', 'a');
    g.ensureNode('b', 'Behavior', 'b');
    g.setEdge('a', 'causes', 'b', { confidence: 0.5, source: 'prior' });
    expect(g.undo('user')).toBe(false);
    g.batch('user', () => g.setEdge('a', 'causes', 'b', { confidence: 0.9, source: 'user' }));
    const copy = new KnowledgeGraph();
    copy.load(JSON.parse(JSON.stringify(g.snapshot())));
    expect(copy.edge('a|causes|b')!.confidence).toBe(0.9);
    expect(copy.undo('user')).toBe(true);
    expect(copy.edge('a|causes|b')!.confidence).toBe(0.5);
  });

  it('reasoner ignores rejected edges and halves disputed ones', () => {
    const edges = [
      { id: 'x|made_of|m', from: 'x', to: 'm', relation: 'made_of', confidence: 1, source: 'prior', status: 'active', evidence: [], updatedAt: 0 },
      { id: 'm|has_property|p', from: 'm', to: 'p', relation: 'has_property', confidence: 0.8, source: 'prior', status: 'disputed', evidence: [], updatedAt: 0 },
    ] as const;
    const r = reason(edges.map((e) => ({ ...e, evidence: [] })), [
      { id: 'mp', label: '', if: [{ s: '?x', r: 'made_of', o: '?m' }, { s: '?m', r: 'has_property', o: '?p' }], then: { s: '?x', r: 'has_property', o: '?p' }, factor: 1 },
    ]);
    expect(r.facts.get('x|has_property|p')!.confidence).toBeCloseTo(0.4, 6);
  });
});

describe('KG migrations', () => {
  it('upgrades a v0 snapshot and rejects unknown future versions', async () => {
    const { migrateSnapshot } = await import('../../src/kg/migrations');
    const v0 = { nodes: [{ id: 'a', type: 'Property', label: 'a', props: {}, createdAt: 0 }], edges: [{ id: 'a|causes|b', from: 'a', to: 'b', relation: 'causes', confidence: 1, source: 'prior', updatedAt: 0 }] };
    const s = migrateSnapshot(v0)!;
    expect(s.schemaVersion).toBe(1);
    expect(s.log).toEqual([]);
    expect(s.edges[0].evidence).toEqual([]);
    expect(s.edges[0].status).toBe('active');
    expect(migrateSnapshot({ schemaVersion: 99 })).toBeNull();
  });
});
