import { describe, expect, it } from 'vitest';
import { bakeFromSdf, describeTemplate, fitTemplate, sculptLabel, sculptSdf } from '../../src/objects/bake';
import { SculptEngine } from '../../src/sculpt/sculpt-engine';
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
    expect(o.parts.length).toBe(1);
    const pieces = o.parts[0].shards;
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const sum = pieces.reduce((a, p) => a + meshVolume(p.positions), 0);
    expect(Math.abs(sum - o.volume) / o.volume).toBeLessThan(0.12);
    // pieces are re-centred: vertex mean ~ 0
    const p = pieces[0].positions;
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

  it('bakes a two-piece sculpt into two closed parts whose volumes add up', () => {
    // a lump (piece 0) with a second lump (piece 1) pressed onto its top
    const e = new SculptEngine(48, 0.25, { x: 0, y: -0.03, z: 0, r: 0.04 });
    e.apply(1, [{ op: 'add', x: 0, y: 0.02, z: 0, r: 0.025, piece: 1 }]);
    expect(e.grid.piecesMask()).toBe(0b11);
    const d = describeShape(e.grid)!;
    const o = bakeFromSdf(sculptSdf(e.grid, d.center, 1), Math.max(...d.extents), { label: sculptLabel(e.grid, d.center, 1), pieces: 6 });
    expect(o.parts.map((x) => x.label)).toEqual([0, 1]);
    const sum = o.parts.reduce((a, x) => a + x.volume, 0);
    expect(Math.abs(sum - o.volume) / o.volume).toBeLessThan(0.08);
    // the lower lump is the bigger part, and each part is a closed mesh with its own shards
    expect(o.parts[0].volume).toBeGreaterThan(o.parts[1].volume * 2);
    for (const part of o.parts) {
      expect(Math.abs(meshVolume(part.mesh.positions) - part.volume) / part.volume).toBeLessThan(1e-6);
      expect(part.shards.length).toBeGreaterThanOrEqual(2);
    }
    // piece 1 sits on top: its vertices are higher on average
    const meanY = (m: Float32Array) => { let y = 0; for (let i = 1; i < m.length; i += 3) y += m[i]; return y / (m.length / 3); };
    expect(meanY(o.parts[1].mesh.positions)).toBeGreaterThan(meanY(o.parts[0].mesh.positions) + 0.02);
  });
});

describe('pieces in the sculpt grid', () => {
  it('Add extends the piece it touches; undo and redo restore the labels', () => {
    const e = new SculptEngine(48, 0.25, { x: 0, y: -0.03, z: 0, r: 0.04 });
    e.apply(1, [{ op: 'add', x: 0, y: 0.02, z: 0, r: 0.025, piece: 1 }]);
    // grow piece 1 upwards with a plain Add touching it
    e.apply(2, [{ op: 'add', x: 0, y: 0.045, z: 0, r: 0.015 }]);
    const g = e.grid;
    expect(g.labelAt(0, 0.05, 0)).toBe(1);
    expect(g.labelAt(0, -0.05, 0)).toBe(0);
    // grow piece 0 sideways
    e.apply(3, [{ op: 'add', x: 0.05, y: -0.03, z: 0, r: 0.015 }]);
    expect(g.labelAt(0.055, -0.03, 0)).toBe(0);
    e.undo(); e.undo(); e.undo();
    expect(g.piecesMask()).toBe(0b1);
    e.redo();
    expect(g.piecesMask()).toBe(0b11);
    expect(g.labelAt(0, 0.025, 0)).toBe(1);
  });

  it('the mesher reports each vertex with its piece', () => {
    const e = new SculptEngine(48, 0.25, { x: 0, y: -0.03, z: 0, r: 0.04 });
    e.apply(1, [{ op: 'add', x: 0, y: 0.02, z: 0, r: 0.025, piece: 1 }]);
    const u = e.remeshAll();
    expect(u.piecesMask).toBe(0b11);
    let top = 0, topIs1 = 0;
    for (const c of u.chunks)
      for (let v = 0; v < c.labels.length; v++)
        if (c.positions[v * 3 + 1] > 0.035) {
          top++;
          if (c.labels[v] === 1) topIs1++;
        }
    expect(top).toBeGreaterThan(0);
    expect(topIs1 / top).toBeGreaterThan(0.95);
  });
});
