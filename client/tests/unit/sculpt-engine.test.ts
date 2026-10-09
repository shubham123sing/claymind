import { describe, expect, it } from 'vitest';
import { SculptEngine, Stroke } from '../../src/sculpt/sculpt-engine';
import { SdfGrid } from '../../src/sculpt/sdf-grid';

const LUMP = { x: 0, y: -0.06, z: 0, r: 0.055 };
const add = (x: number): Stroke => ({ op: 'add', x, y: -0.06, z: 0, r: 0.015 });

describe('SculptEngine history', () => {
  it('undo restores the exact previous field, redo re-applies it', () => {
    const e = new SculptEngine(32, 0.25, LUMP);
    e.update();
    const before = e.grid.data.slice();
    e.apply(1, [add(0.05)]);
    e.apply(1, [add(0.06)]);
    const after = e.grid.data.slice();
    expect(e.undo()).toBe(true);
    expect(e.grid.data).toEqual(before);
    expect(e.redo()).toBe(true);
    expect(e.grid.data).toEqual(after);
  });

  it('survives many actions across checkpoints and undoes back to the start', () => {
    const e = new SculptEngine(32, 0.25, LUMP);
    const start = e.grid.data.slice();
    for (let a = 1; a <= 40; a++) e.apply(a, [add(0.04 + (a % 5) * 0.005)]);
    for (let a = 0; a < 40; a++) expect(e.undo()).toBe(true);
    expect(e.undo()).toBe(false);
    expect(e.grid.data).toEqual(start);
  });

  it('a new action after undo clears redo', () => {
    const e = new SculptEngine(32, 0.25, LUMP);
    e.apply(1, [add(0.05)]);
    e.undo();
    e.apply(2, [add(-0.05)]);
    expect(e.redo()).toBe(false);
  });

  it('reset stroke is undoable', () => {
    const e = new SculptEngine(32, 0.25, LUMP);
    e.apply(1, [add(0.06)]);
    const shaped = e.grid.data.slice();
    e.apply(2, [{ op: 'reset', x: 0, y: 0, z: 0, r: 0 }]);
    e.undo();
    expect(e.grid.data).toEqual(shaped);
  });

  it('reports volume and AABB; resample keeps the shape', () => {
    const e = new SculptEngine(48, 0.25, LUMP);
    const u = e.update();
    const expected = (4 / 3) * Math.PI * LUMP.r ** 3;
    expect(Math.abs(u.volume - expected) / expected).toBeLessThan(0.04);
    expect(u.aabb![3] - u.aabb![0]).toBeCloseTo(2 * LUMP.r, 2);
    e.resample(32);
    const r = e.update();
    expect(r.res).toBe(32);
    expect(Math.abs(r.volume - expected) / expected).toBeLessThan(0.08);
  });
});

describe('SdfGrid brushes', () => {
  it('drag pulls material outward (AABB grows in the drag direction)', () => {
    const e = new SculptEngine(48, 0.25, LUMP);
    const before = e.update().aabb!;
    e.apply(1, [{ op: 'drag', x: LUMP.r - 0.002, y: -0.06, z: 0, r: 0.02, dx: 0.03, dy: 0, dz: 0 }]);
    const after = e.update().aabb!;
    expect(after[3]).toBeGreaterThan(before[3] + 0.015);
  });

  it('add with a delta sweeps a continuous capsule', () => {
    const e = new SculptEngine(48, 0.25, LUMP);
    e.update();
    // a 6 cm bar along +z floating above the lump
    e.apply(1, [{ op: 'add', x: 0, y: 0.04, z: -0.03, r: 0.008, dx: 0, dy: 0, dz: 0.06 }]);
    const u = e.update();
    expect(u.aabb![4]).toBeGreaterThan(0.045); // bar top (y 0.04 + r) is part of the surface
    // midpoint of the bar is solid: volume grew by roughly a capsule (pi r^2 L + 4/3 pi r^3)
    const capsule = Math.PI * 0.008 ** 2 * 0.06 + (4 / 3) * Math.PI * 0.008 ** 3;
    const base = (4 / 3) * Math.PI * LUMP.r ** 3;
    expect(u.volume - base).toBeGreaterThan(capsule * 0.6);
  });

  it('a small stroke re-meshes few chunks (precise dirty marking)', () => {
    const g = new SdfGrid(48, 0.25);
    g.fillSphere(0, 0, 0, 0.06);
    g.dirty.fill(0);
    g.brush('add', 0.06, 0, 0, 0.012);
    const dirty = g.dirty.reduce((a, b) => a + b, 0);
    expect(dirty).toBeLessThanOrEqual(12);
  });
});
