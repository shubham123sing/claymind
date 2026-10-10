import { describe, expect, it } from 'vitest';
import { SculptEngine } from '../../src/sculpt/sculpt-engine';

const RED = 0xff2010;
const lump = () => new SculptEngine(48, 0.25, { x: 0, y: 0, z: 0, r: 0.05 });

/** Paint at the clay point nearest to (x, y, z): RGBA. */
function paintNear(e: SculptEngine, x: number, y: number, z: number): number[] {
  const out = [0, 0, 0, 0];
  e.grid.nearestInsidePaint(x, y, z, 0.012, out);
  return out;
}

/** Share of surface vertices within `r` of (x, y, z) that are painted red. */
function redShare(e: SculptEngine, x: number, y: number, z: number, r: number): number {
  let n = 0, red = 0;
  for (const c of e.remeshAll().chunks)
    for (let v = 0; v < c.labels.length; v++) {
      const px = c.positions[v * 3], py = c.positions[v * 3 + 1], pz = c.positions[v * 3 + 2];
      if (Math.hypot(px - x, py - y, pz - z) > r) continue;
      n++;
      if (c.paint[v * 4 + 3] === 255 && c.paint[v * 4] === 0xff && c.paint[v * 4 + 1] === 0x20) red++;
    }
  return n ? red / n : 0;
}

describe('painting on the clay', () => {
  it('paints the surface under the brush only, and leaves the shape alone', () => {
    const e = lump();
    const before = e.grid.data.slice();
    e.apply(1, [{ op: 'paint', x: 0.05, y: 0, z: 0, r: 0.01, rgb: RED }]);
    expect([...e.grid.data]).toEqual([...before]);
    expect(redShare(e, 0.05, 0, 0, 0.006)).toBeGreaterThan(0.9);
    expect(redShare(e, -0.05, 0, 0, 0.01)).toBe(0);
  });

  it('the eraser brings back the piece colour (unpainted)', () => {
    const e = lump();
    e.apply(1, [{ op: 'paint', x: 0.05, y: 0, z: 0, r: 0.01, rgb: RED }]);
    e.apply(2, [{ op: 'erase', x: 0.05, y: 0, z: 0, r: 0.012 }]);
    expect(paintNear(e, 0.05, 0, 0)[3]).toBe(0);
  });

  it('paint stays on the surface while sculpting: pulled clay carries it, new clay is unpainted', () => {
    const e = lump();
    e.apply(1, [{ op: 'paint', x: 0.05, y: 0, z: 0, r: 0.012, rgb: RED }]);
    // pull the painted side out by 2 cm
    e.apply(2, [{ op: 'drag', x: 0.05, y: 0, z: 0, r: 0.02, dx: 0.02, dy: 0, dz: 0 }]);
    expect(redShare(e, 0.068, 0, 0, 0.006)).toBeGreaterThan(0.6);
    // add clay on the other side: no paint there
    e.apply(3, [{ op: 'add', x: -0.06, y: 0, z: 0, r: 0.015 }]);
    expect(paintNear(e, -0.07, 0, 0)[3]).toBe(0);
  });

  it('undo and redo restore paint', () => {
    const e = lump();
    e.apply(1, [{ op: 'paint', x: 0.05, y: 0, z: 0, r: 0.01, rgb: RED }]);
    e.undo();
    expect(redShare(e, 0.05, 0, 0, 0.006)).toBe(0);
    e.redo();
    expect(redShare(e, 0.05, 0, 0, 0.006)).toBeGreaterThan(0.9);
  });
});
