import { describe, expect, it } from 'vitest';
import { estimateMaterial, getMaterial, MATERIALS, shapePriors } from '../../src/materials/materials';
import type { ShapeDescriptor } from '../../src/objects/descriptor';

const base: ShapeDescriptor = {
  aspect: 1, elong: 1, fill: 0.5, openTop: 0, holes: 0, profile: [1, 1, 1, 1, 1],
  angle: 0, center: [0, 0, 0], extents: [0.1, 0.1, 0.1], volume: 0.0005,
};

describe('material table', () => {
  it('has at least 12 materials with complete physics fields', () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(12);
    for (const m of MATERIALS) {
      expect(m.density).toBeGreaterThan(0);
      expect(m.friction).toBeGreaterThanOrEqual(0);
      expect(m.restitution).toBeGreaterThanOrEqual(0);
      expect(m.restitution).toBeLessThanOrEqual(1);
      expect(m.sound.partials.length).toBeGreaterThan(0);
      if (m.fragility) expect(m.fragility.breakSpeed).toBeGreaterThan(0);
    }
  });

  it('glass breaks more easily than ceramic, and steel never breaks', () => {
    expect(getMaterial('glass').fragility!.breakSpeed).toBeLessThan(getMaterial('ceramic').fragility!.breakSpeed);
    expect(getMaterial('steel').fragility).toBeNull();
  });

  it('unknown ids fall back to clay', () => {
    expect(getMaterial('unobtainium').id).toBe('clay');
  });
});

describe('material estimator', () => {
  it('cup-like shapes lean ceramic; long thin shapes lean wood', () => {
    expect(estimateMaterial([{ priors: shapePriors({ ...base, openTop: 0.9 }), weight: 1 }])[0].id).toBe('ceramic');
    expect(estimateMaterial([{ priors: shapePriors({ ...base, elong: 0.2, aspect: 0.4 }), weight: 1 }])[0].id).toBe('wood');
  });

  it('normalises combined evidence into probabilities', () => {
    const g = estimateMaterial([
      { priors: { ceramic: 0.6, plastic: 0.4 }, weight: 1 },
      { priors: { plastic: 1 }, weight: 1 },
    ]);
    expect(g[0].id).toBe('plastic');
    expect(g.reduce((a, x) => a + x.prob, 0)).toBeCloseTo(1, 6);
  });
});
