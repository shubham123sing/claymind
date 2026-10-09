import { describe, expect, it } from 'vitest';
import { bakeFromSdf, describeTemplate, fitTemplate, sculptSdf } from '../../src/objects/bake';
import { compile } from '../../src/objects/csg';
import { describe as describeShape, rasterize, sdfBounds } from '../../src/objects/descriptor';
import { meshVolume } from '../../src/sculpt/marching-cubes';
import { getTemplate } from '../../src/objects/templates';

describe('bake', () => {
  it('bakes a sphere with correct volume, size and fracture pieces that add up', () => {
    const r = 0.04;
    const o = bakeFromSdf((x, y, z) => Math.hypot(x, y, z) - r, 2 * r, { pieces: 6 });
    const v = (4 / 3) * Math.PI * r ** 3;
    expect(Math.abs(o.volume - v) / v).toBeLessThan(0.03);
    expect(o.size[1]).toBeCloseTo(2 * r, 2);
    expect(o.pieces.length).toBeGreaterThanOrEqual(5);
    const sum = o.pieces.reduce((a, p) => a + meshVolume(p.positions), 0);
    expect(Math.abs(sum - o.volume) / o.volume).toBeLessThan(0.12);
    // pieces are re-centred: vertex mean ~ 0
    const p = o.pieces[0].positions;
    let mx = 0;
    for (let i = 0; i < p.length; i += 3) mx += p[i];
    expect(Math.abs(mx / (p.length / 3))).toBeLessThan(1e-4);
  });

  it('fits the mug template onto a rotated, rescaled mug sculpt', () => {
    const tmpl = describeTemplate(getTemplate('mug')!);
    // a "sculpted" mug: template rotated 60° and 1.2x larger in the sculpt grid
    const src = compile(getTemplate('mug')!.sdf);
    const b = sdfBounds(src);
    const cy = (b.min[1] + b.max[1]) / 2;
    const a = Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), S = 1.2;
    const grid = rasterize(src, 48, 0.25, [0, 0, 0], (x, y, z, out) => {
      out[0] = (x * ca + z * sa) / S; out[1] = y / S + cy; out[2] = (-x * sa + z * ca) / S;
      return S;
    });
    const d = describeShape(grid)!;
    const sculpt = sculptSdf(grid, d.center, 1);
    const fitted = fitTemplate(tmpl, d, sculpt, 1);
    // IoU of fitted template vs sculpt on a 40³ lattice
    let inter = 0, union = 0;
    const h = 0.08;
    for (let k = 0; k < 40; k++)
      for (let j = 0; j < 40; j++)
        for (let i = 0; i < 40; i++) {
          const x = -h + (i / 39) * 2 * h, y = -h + (j / 39) * 2 * h, z = -h + (k / 39) * 2 * h;
          const p = fitted(x, y, z) < 0, q = sculpt(x, y, z) < 0;
          if (p && q) inter++;
          if (p || q) union++;
        }
    expect(inter / union).toBeGreaterThan(0.6);
  });
});
