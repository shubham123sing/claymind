import { describe, expect, it } from 'vitest';
import { bakeFromSdf } from '../../src/objects/bake';
import { MAX_BOXES } from '../../src/objects/collider';

/** A cup: 9 cm wide, 8 cm tall, 6 mm walls, 6 mm base (object-local, centred). */
const cup = (x: number, y: number, z: number) => {
  const r = Math.hypot(x, z);
  const outer = Math.max(r - 0.045, Math.abs(y) - 0.04);
  const inner = Math.max(r - 0.039, -(y + 0.034));
  return Math.max(outer, -inner);
};

describe('piece colliders', () => {
  it('a ball gets a convex hull', () => {
    const o = bakeFromSdf((x, y, z) => Math.hypot(x, y, z) - 0.04, 0.08, { pieces: 2 });
    expect(o.parts[0].collider.kind).toBe('hull');
  });

  it('a rod (hammer handle) and a capsule get hulls', () => {
    const rod = bakeFromSdf((x, y, z) => Math.max(Math.hypot(y, z) - 0.011, Math.abs(x) - 0.085), 0.17, { pieces: 2 });
    expect(rod.parts[0].collider.kind).toBe('hull');
    const capsule = bakeFromSdf((x, y, z) => Math.hypot(Math.max(0, Math.abs(x) - 0.03), y, z) - 0.017, 0.1, { pieces: 2 });
    expect(capsule.parts[0].collider.kind).toBe('hull');
  });

  it('a cup gets at most 40 boxes that leave its inside open', () => {
    const o = bakeFromSdf(cup, 0.09, { pieces: 2 });
    const c = o.parts[0].collider;
    expect(c.kind).toBe('boxes');
    if (c.kind !== 'boxes') return;
    const n = c.boxes.length / 6;
    // nothing solid in the middle of the cup above the base
    let blocked = false;
    for (let i = 0; i < c.boxes.length; i += 6) {
      const [x, y, z, sx, sy, sz] = c.boxes.slice(i, i + 6);
      if (Math.abs(x) < sx / 2 + 0.01 && Math.abs(z) < sz / 2 + 0.01 && y + sy / 2 > -0.02) blocked = true;
    }
    console.info(`[collider] cup: ${n} boxes, volume ${(c.volume * 1e6).toFixed(0)} cm³ (mesh ${(o.parts[0].volume * 1e6).toFixed(0)} cm³)`);
    expect(n).toBeLessThanOrEqual(MAX_BOXES);
    expect(n).toBeGreaterThan(4);
    expect(blocked).toBe(false);
  });
});
