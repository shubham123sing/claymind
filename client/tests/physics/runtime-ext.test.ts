/**
 * ClayMind's extended physics runtime (the one the game's worker runs):
 * compound colliders through IWSDK's hull buffer, and collision events.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getMaterial } from '../../src/materials/materials';
import { boxMesh, computePhysicalProperties } from '../../src/physics/physical-properties';
import { decodeCompound, encodeCompound } from '../../src/physics/runtime/compound-format';
import { HavokSim, tiltOf } from './havok-sim';

let sim: HavokSim | null = null;
afterEach(() => {
  sim?.destroy();
  sim = null;
});

const corners = (min: number[], max: number[]) => {
  const v: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) v.push(x, y, z);
  return new Float32Array(v);
};
const mat = (id: string) => ({ density: getMaterial(id).density, friction: getMaterial(id).friction, restitution: getMaterial(id).restitution });

describe('compound format', () => {
  it('round-trips hull and box children', () => {
    const kids = [
      { kind: 'hull' as const, ...mat('wood'), data: corners([0, 0, 0], [1, 2, 3]) },
      { kind: 'boxes' as const, ...mat('stone'), data: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 0.5, 0.5, 0.5]) },
    ];
    const enc = encodeCompound(kids);
    expect(enc.length % 3).toBe(0);
    const dec = decodeCompound(enc);
    expect(dec.map((d) => d.kind)).toEqual(['hull', 'boxes']);
    expect([...dec[0].data]).toEqual([...kids[0].data]);
    expect([...dec[1].data]).toEqual([...kids[1].data]);
    expect(dec[1].density).toBeCloseTo(getMaterial('stone').density, 3);
    expect(dec[0].frame).toEqual({ p: [0, 0, 0], q: [0, 0, 0, 1] });
    const moved = decodeCompound(encodeCompound([{ ...kids[0], frame: { p: [1, 2, 3], q: [0, 1, 0, 0] } }]));
    expect(moved[0].frame).toEqual({ p: [1, 2, 3], q: [0, 1, 0, 0] });
  });
});

describe('extended runtime', () => {
  it('a compound hammer (wood handle hull + stone head hull): Havok centre of mass = computePhysicalProperties', async () => {
    sim = await HavokSim.create({ ext: true });
    const handle = { min: [0, 0.005, -0.01], max: [0.25, 0.025, 0.01] }, head = { min: [0.25, 0, -0.045], max: [0.28, 0.03, 0.045] };
    sim.add({
      shape: { type: 'Compound', children: [
        { kind: 'hull', ...mat('wood'), data: corners(handle.min, handle.max) },
        { kind: 'hull', ...mat('stone'), data: corners(head.min, head.max) },
      ] },
      position: [0, 1, 0],
    });
    const ours = computePhysicalProperties([
      { id: 0, materialId: 'wood', positions: boxMesh(handle.min as never, handle.max as never) },
      { id: 1, materialId: 'stone', positions: boxMesh(head.min as never, head.max as never) },
    ]);
    console.info(`[ext] compound COM ${sim.lastCom.map((v) => (v * 100).toFixed(2)).join(', ')} cm · ours ${ours.com.map((v) => (v * 100).toFixed(2)).join(', ')} cm`);
    for (let a = 0; a < 3; a++) expect(sim.lastCom[a]).toBeCloseTo(ours.com[a], 4);
  });

  it('a child frame moves the child inside the body (centre of mass follows)', async () => {
    sim = await HavokSim.create({ ext: true });
    const cube = corners([-0.05, -0.05, -0.05], [0.05, 0.05, 0.05]);
    sim.add({ shape: { type: 'Compound', children: [
      { kind: 'hull', ...mat('wood'), data: cube },
      { kind: 'hull', ...mat('wood'), data: cube, frame: { p: [0.2, 0, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } },
    ] }, position: [0, 1, 0] });
    expect(sim.lastCom[0]).toBeCloseTo(0.1, 4);
  });

  it('children keep their own friction (rubber + slick runners turn the sled)', async () => {
    sim = await HavokSim.create({ ext: true });
    sim.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
    const sled = (fl: number, fr: number, x: number) => sim!.add({
      shape: { type: 'Compound', children: [
        { kind: 'boxes', density: 1000, friction: fl, restitution: 0, data: new Float32Array([-0.1, 0, 0, 0.04, 0.02, 0.2]) },
        { kind: 'boxes', density: 1000, friction: fr, restitution: 0, data: new Float32Array([0.1, 0, 0, 0.04, 0.02, 0.2]) },
      ] },
      position: [x, 0.0105, 0],
    });
    const even = sled(0.5, 0.5, -0.6), mixed = sled(1, 0.02, 0.6);
    sim.step(1);
    for (const h of [even, mixed]) sim.setVelocity(h, [0, 0, -1.5]);
    sim.seconds(1);
    const yaw = (h: number) => { const q = sim!.get(h).q; return Math.abs((2 * Math.atan2(q[1], q[3]) * 180) / Math.PI); };
    console.info(`[ext] sled yaw: equal ${yaw(even).toFixed(1)} deg, mixed ${yaw(mixed).toFixed(1)} deg`);
    expect(yaw(even)).toBeLessThan(1);
    expect(yaw(mixed)).toBeGreaterThan(10);
  });

  it('a box-built cup holds pebbles; contacts arrive with handles and impulses', async () => {
    sim = await HavokSim.create({ ext: true });
    const table = sim.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
    const boxes: number[] = [0, 0.003, 0, 0.09, 0.006, 0.09];
    const walls = 24, R = 0.042;
    for (let i = 0; i < walls; i++) {
      // axis-aligned boxes only (as from a voxel grid): a ring of small posts
      const a = (i / walls) * Math.PI * 2;
      boxes.push(Math.cos(a) * R, 0.04, Math.sin(a) * R, 0.012, 0.08, 0.012);
    }
    const cup = sim.add({ shape: { type: 'Compound', children: [{ kind: 'boxes', ...mat('stone'), data: new Float32Array(boxes) }] }, position: [0, 0.0005, 0] });
    const pebbles = Array.from({ length: 10 }, (_, i) =>
      sim!.add({ shape: { type: 'Sphere', r: 0.008 }, position: [((i % 3) - 1) * 0.018, 0.1 + Math.floor(i / 3) * 0.02, ((i % 2) - 0.5) * 0.01], density: 2600 }));
    sim.seconds(2);
    const c = sim.get(cup).p;
    const inside = pebbles.filter((h) => Math.hypot(sim!.get(h).p[0] - c[0], sim!.get(h).p[2] - c[2]) < 0.04).length;
    const pebbleCup = sim.contacts.filter((m) => (m.a === cup && pebbles.includes(m.b)) || (m.b === cup && pebbles.includes(m.a))).length;
    const cupTable = sim.contacts.filter((m) => (m.a === cup && m.b === table) || (m.b === cup && m.a === table));
    console.info(`[ext] cup: ${inside}/10 pebbles inside, ${sim.contacts.length} contacts (${pebbleCup} pebble-cup), cup-table impulse ${cupTable[0]?.impulse.toFixed(4) ?? '-'}`);
    expect(inside).toBe(10);
    // a contact is reported once per new pair; most pebbles land on other pebbles first
    expect(pebbleCup).toBeGreaterThanOrEqual(2);
    expect(sim.contacts.every((m) => m.impulse > 0 && Number.isFinite(m.p[0]))).toBe(true);
  });

  it('many sub-steps in one call (a slow frame): the hit is still reported, results match single steps', async () => {
    const run = async (many: boolean) => {
      const s = await HavokSim.create({ ext: true });
      s.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
      const ball = s.add({ shape: { type: 'Sphere', r: 0.03 }, position: [0, 0.3, 0], density: 2600, restitution: 0.3 });
      if (many) s.stepMany(72);
      else s.step(72);
      const out = { contacts: s.contacts.length, y: s.get(ball).p[1] };
      s.destroy();
      return out;
    };
    const one = await run(false), many = await run(true);
    console.info(`[ext] 72 single steps: ${one.contacts} contacts, y ${one.y.toFixed(4)} · one call of 72: ${many.contacts} contacts, y ${many.y.toFixed(4)}`);
    expect(many.contacts).toBeGreaterThanOrEqual(1);
    expect(many.contacts).toBe(one.contacts);
    expect(many.y).toBeCloseTo(one.y, 4);
  });

  it('a ball hitting the table: one contact with impulse ~ m·v (plain shapes still go through IWSDK)', async () => {
    sim = await HavokSim.create({ ext: true });
    const table = sim.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
    const r = 0.03, ball = sim.add({ shape: { type: 'Sphere', r }, position: [0, 0.5, 0], density: 2600, restitution: 0.1 });
    let v = 0;
    sim.seconds(0.5, () => {
      if (!sim!.contacts.length) v = -sim!.get(ball).v[1];
    });
    const m = 2600 * (4 / 3) * Math.PI * r ** 3;
    const hit = sim.contacts.find((c) => (c.a === ball && c.b === table) || (c.b === ball && c.a === table));
    console.info(`[ext] ball hit: impulse ${hit?.impulse.toFixed(3)} N·s, m·v ${(m * v).toFixed(3)}`);
    expect(hit).toBeDefined();
    expect(hit!.impulse).toBeGreaterThan(m * v * 0.8);
    expect(hit!.impulse).toBeLessThan(m * v * 1.5);
    void tiltOf;
  });
});
