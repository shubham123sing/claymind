/**
 * Phase 6a spike (plan v3), run on IWSDK's own Havok runtime at 72 Hz.
 *   A  one body with our own centre of mass: does tipping follow it? (box and convex hull)
 *   B  chain of contact without contact events: ball -> block A -> block B
 *   C  tunnelling of small fast spheres through a 1 cm wall and a 3 cm table
 * Measured numbers are printed and recorded in docs/KNOWN_LIMITS.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HavokSim, tiltOf } from './havok-sim';

let sim: HavokSim;
beforeEach(async () => {
  sim = await HavokSim.create();
  // the table: 3 cm thick, top at y = 0
  sim.add({ shape: { type: 'Box', size: [2, 0.03, 2] }, state: 'STATIC', position: [0, -0.015, 0], friction: 0.6, restitution: 0.2 });
});
afterEach(() => sim.destroy());

const TALL: [number, number, number] = [0.04, 0.16, 0.04];
const boxCorners = (w: number, h: number, d: number) => {
  const v: number[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) v.push(x, y, z);
  return new Float32Array(v);
};

describe('6a-A: centre of mass override on one body', () => {
  it('tipping follows our centre of mass (box and convex hull)', () => {
    const y = 0.08 + 0.0005;
    const auto = sim.add({ shape: { type: 'Box', size: TALL }, position: [-0.3, y, 0], density: 600 });
    const right = sim.add({ shape: { type: 'Box', size: TALL }, position: [-0.1, y, 0], density: 600, centerOfMass: [0.03, 0, 0] });
    const left = sim.add({ shape: { type: 'Box', size: TALL }, position: [0.1, y, 0], density: 600, centerOfMass: [-0.03, 0, 0] });
    const hull = sim.add({ shape: { type: 'ConvexHull', vertices: boxCorners(...TALL) }, position: [0.3, y, 0], density: 600, centerOfMass: [0.03, 0, 0] });
    for (const h of [auto, right, left, hull]) sim.setVelocity(h, [0, -0.01, 0]);
    sim.seconds(2.5);
    const t = Object.fromEntries(Object.entries({ auto, right, left, hull }).map(([k, h]) => [k, tiltOf(sim.get(h).q)]));
    console.info('[6a-A] tilt after 2.5 s', JSON.stringify(t));
    expect(t.auto.deg).toBeLessThan(3);
    expect(t.right.deg).toBeGreaterThan(60);
    expect(t.right.leanX).toBe(1);
    expect(t.left.deg).toBeGreaterThan(60);
    expect(t.left.leanX).toBe(-1);
    expect(t.hull.deg).toBeGreaterThan(60);
    expect(t.hull.leanX).toBe(1);
  });

  it('a low centre of mass resists the same push that topples a centred one', () => {
    const y = 0.08 + 0.0005;
    const centred = sim.add({ shape: { type: 'Box', size: TALL }, position: [-0.2, y, 0], density: 600 });
    const low = sim.add({ shape: { type: 'Box', size: TALL }, position: [0.2, y, 0], density: 600, centerOfMass: [0, -0.06, 0] });
    for (const h of [centred, low]) sim.setAngularVelocity(h, [0, 0, -3.2]);
    sim.seconds(2.5);
    const c = tiltOf(sim.get(centred).q), l = tiltOf(sim.get(low).q);
    console.info('[6a-A] push: centred', c, 'low', l);
    expect(c.deg).toBeGreaterThan(60);
    expect(l.deg).toBeLessThan(10);
  });
});

describe('6a-B: chain of contact from velocity changes', () => {
  it('infers ball -> block A -> block B without contact events', () => {
    const r = 0.02, cube: [number, number, number] = [0.04, 0.04, 0.04];
    const bodies = [
      { name: 'ball', h: sim.add({ shape: { type: 'Sphere', r }, position: [-0.2, r, 0], density: 7800, friction: 0.4 }), half: r },
      { name: 'block A', h: sim.add({ shape: { type: 'Box', size: cube }, position: [-0.1, 0.02, 0], density: 600 }), half: 0.02 },
      { name: 'block B', h: sim.add({ shape: { type: 'Box', size: cube }, position: [-0.045, 0.02, 0], density: 600 }), half: 0.02 },
    ];
    sim.step(2);
    sim.setVelocity(bodies[0].h, [1.4, 0, 0]);
    const speed = (v: number[]) => Math.hypot(v[0], v[2]);
    let prev = bodies.map((b) => [...sim.get(b.h).v]);
    const chain: string[] = [];
    const events: { t: number; body: string; dv: number; from?: string }[] = [];
    sim.seconds(1.2, () => {
      const now = bodies.map((b) => [...sim.get(b.h).v]);
      const gained = now.map((v, i) => speed(v) - speed(prev[i]));
      bodies.forEach((b, i) => {
        const dv = Math.hypot(now[i][0] - prev[i][0], now[i][2] - prev[i][2]);
        if (dv < 0.25 || gained[i] <= 0) return;
        const p = sim.get(b.h).p;
        let from: string | undefined, best = Infinity;
        bodies.forEach((o, j) => {
          if (j === i || gained[j] >= 0) return;
          const q = sim.get(o.h).p;
          const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - b.half - o.half;
          if (d < 0.015 && d < best) (best = d), (from = o.name);
        });
        events.push({ t: Math.round(sim.time * 1000), body: b.name, dv: +dv.toFixed(2), from });
        if (from && !chain.includes(`${from} -> ${b.name}`)) chain.push(`${from} -> ${b.name}`);
      });
      prev = now;
    });
    console.info('[6a-B] events', JSON.stringify(events), 'final x', bodies.map((b) => sim.get(b.h).p[0].toFixed(3)));
    expect(chain).toEqual(['ball -> block A', 'block A -> block B']);
  });
});

describe('6a-C: tunnelling (no CCD flag in IWSDK)', () => {
  it('measures which speeds pass through a 1 cm wall and a 3 cm table', () => {
    const r = 0.01, wallX = 0.3;
    sim.add({ shape: { type: 'Box', size: [0.01, 0.1, 0.3] }, state: 'STATIC', position: [wallX, 0.05, 0] });
    const speeds = [2, 4, 6, 8, 12, 20, 30];
    const side = speeds.map((_, i) => sim.add({ shape: { type: 'Sphere', r }, position: [wallX - 0.12, 0.04, (i - 3) * 0.035], density: 7800, gravityFactor: 0 }));
    const down = speeds.map((_, i) => sim.add({ shape: { type: 'Sphere', r }, position: [-0.6 + i * 0.06, 0.15, 0.5], density: 7800, gravityFactor: 0 }));
    // thin dynamic piece: a 5 mm plate thrown flat at a 1 cm wall (piece vs static)
    const plates = speeds.map((_, i) => sim.add({ shape: { type: 'Box', size: [0.005, 0.03, 0.03] }, position: [-wallX + 0.12, 0.04, (i - 3) * 0.035], density: 2500, gravityFactor: 0 }));
    sim.add({ shape: { type: 'Box', size: [0.01, 0.1, 0.3] }, state: 'STATIC', position: [-wallX, 0.05, 0] });
    sim.step(1);
    speeds.forEach((s, i) => {
      sim.setVelocity(side[i], [s, 0, 0]);
      sim.setVelocity(down[i], [0, -s, 0]);
      sim.setVelocity(plates[i], [-s, 0, 0]);
    });
    sim.seconds(0.6);
    const rows = speeds.map((s, i) => ({
      speed: s,
      ballVsWall1cm: sim.get(side[i]).p[0] > wallX ? 'TUNNELLED' : 'stopped',
      ballVsTable3cm: sim.get(down[i]).p[1] < -0.015 ? 'TUNNELLED' : 'stopped',
      plate5mmVsWall1cm: sim.get(plates[i]).p[0] < -wallX ? 'TUNNELLED' : 'stopped',
    }));
    console.info('[6a-C]\n' + rows.map((r) => JSON.stringify(r)).join('\n'));
    // our throw cap is 6 m/s: everything up to it must hold
    for (const row of rows.filter((x) => x.speed <= 6)) expect(Object.values(row).includes('TUNNELLED')).toBe(false);
  });
});
