import { describe, expect, it } from 'vitest';
import { Brain } from '../../src/kg/brain';
import { focusGraph } from '../../src/kgview/focus';
import { layoutGraph } from '../../src/kgview/layout';
import type { Creation } from '../../src/objects/creation';

const mug: Creation = {
  schemaVersion: 1, id: 'm1', createdAt: 0, name: 'Mug', category: 'container', source: 'template', templateId: 'mug',
  matchScore: 0.85, bestGuess: null, materialId: 'ceramic', materialConfidence: 0.65, materialGuesses: [], massKg: 0.3,
  sizeCm: [11, 10, 8], volumeCm3: 130, timeToObject: 0.1, kgNodeIds: [],
  descriptor: { aspect: 0.9, elong: 0.78, fill: 0.2, openTop: 0.9, holes: 1, profile: [1, 1, 1, 1, 1], angle: 0, center: [0, 0, 0], extents: [0.1, 0.1, 0.08], volume: 1e-4 },
};

describe('brain view model', () => {
  it('focus graph contains every edge on every shown reasoning path and stays small', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(mug);
    const fg = focusGraph(b, id);
    const edgeIds = new Set(fg.edges.map((e) => e.id));
    for (const p of fg.predictions) for (const e of p.path) expect(edgeIds.has(e)).toBe(true);
    expect(fg.nodes.length).toBeLessThanOrEqual(40);
    expect(fg.nodes.some((n) => n.id === id)).toBe(true);
  });

  it('cut edges stay visible (faded) so they can be found and undone', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(mug);
    b.cutEdge(`cre:m1|made_of|mat:ceramic`);
    const fg = focusGraph(b, id);
    expect(fg.edges.find((e) => e.id === 'cre:m1|made_of|mat:ceramic')?.status).toBe('rejected');
  });

  it('layout is deterministic, left-to-right by node type, within the panel', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const id = b.addCreation(mug);
    const fg = focusGraph(b, id);
    const a = layoutGraph(fg.nodes, fg.edges);
    const c = layoutGraph(fg.nodes, fg.edges);
    expect([...a.entries()]).toEqual([...c.entries()]);
    const x = (nid: string) => a.get(nid)![0];
    expect(x(id)).toBeLessThan(x('mat:ceramic'));
    expect(x('mat:ceramic')).toBeLessThan(x('prop:fragile'));
    expect(x('prop:fragile')).toBeLessThan(x('beh:breaks_when_dropped'));
    for (const [, p] of a) {
      expect(Math.abs(p[0])).toBeLessThanOrEqual(0.28 + 1e-9);
      expect(Math.abs(p[1])).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it('overview (no focus) shows materials, properties and behaviours', () => {
    const b = new Brain();
    b.seedIfEmpty();
    const fg = focusGraph(b, null);
    const types = new Set(fg.nodes.map((n) => n.type));
    expect(types.has('Material') && types.has('Property') && types.has('Behavior')).toBe(true);
    expect(fg.nodes.length).toBeLessThanOrEqual(40);
  });
});
