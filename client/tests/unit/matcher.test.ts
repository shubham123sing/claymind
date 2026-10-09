import { describe, expect, it } from 'vitest';
import { compile, Sdf } from '../../src/objects/csg';
import { describe as describeShape, rasterize, sdfBounds, ShapeDescriptor } from '../../src/objects/descriptor';
import { rank } from '../../src/objects/matcher';
import { TEMPLATES } from '../../src/objects/templates';

/** Template descriptor the way the worker computes it (res 40, cube around the solid). */
function templateDescriptor(sdf: Sdf): ShapeDescriptor {
  const b = sdfBounds(sdf);
  const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const edge = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1.3;
  return describeShape(rasterize(sdf, 40, edge, c))!;
}

/** The template "as sculpted": scaled, yawed, placed in the 25 cm, 48³ sculpt grid. */
function asSculpt(sdf: Sdf, scale: number, yawDeg: number): ShapeDescriptor {
  const a = (yawDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const b = sdfBounds(sdf);
  const cy = (b.min[1] + b.max[1]) / 2;
  const g = rasterize(sdf, 48, 0.25, [0, 0, 0], (x, y, z, out) => {
    // grid point -> template space: un-yaw, un-scale, recentre vertically
    const ux = (x * ca + z * sa) / scale, uz = (-x * sa + z * ca) / scale;
    out[0] = ux; out[1] = y / scale + cy; out[2] = uz;
    return scale;
  });
  return describeShape(g)!;
}

const T = TEMPLATES.map((t) => ({ id: t.id, sdf: compile(t.sdf) }));
const candidates = T.map((t) => ({ id: t.id, descriptor: templateDescriptor(t.sdf) }));

describe('templates + matcher', () => {
  it('loads all template files', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it('descriptors capture the signature features', () => {
    const d = Object.fromEntries(candidates.map((c) => [c.id, c.descriptor]));
    expect(d.mug.openTop).toBeGreaterThan(0.7);
    expect(d.mug.holes).toBe(1);
    expect(d.ring.holes).toBe(1);
    expect(d.ball.holes).toBe(0);
    expect(d.ball.openTop).toBeLessThan(0.2);
    expect(d.plank.elong).toBeLessThan(0.35);
    expect(d.plate.aspect).toBeLessThan(0.3);
    expect(d.bottle.profile[4]).toBeLessThan(0.6); // narrow neck
  });

  for (const t of T) {
    it(`a sculpted ${t.id} (scaled, rotated, sculpt resolution) matches itself`, () => {
      const q = asSculpt(t.sdf, 1.15, 37);
      const r = rank(q, candidates);
      expect(r[0].id).toBe(t.id);
      expect(r[0].similarity).toBeGreaterThan(0.7); // TEMPLATE_THRESHOLD in sculpt-system.ts
    });
  }

  it('a plain lump is a ball, not a mug', () => {
    const lump = compile({ prim: 'ellipsoid', radii: [0.05, 0.045, 0.048], at: [0, 0.045, 0] });
    const r = rank(asSculpt(lump, 1, 0), candidates);
    expect(r[0].id).toBe('ball');
  });
});
