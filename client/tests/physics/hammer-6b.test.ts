/**
 * Phase 6b acceptance (plan v3): a hammer with a stone head and a wooden handle
 * tips and hits differently from an all-wood hammer, and tipping matches the
 * centre of mass from computePhysicalProperties. Run on IWSDK's Havok runtime.
 */
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { feltSpeed, matchup } from '../../src/materials/matchups';
import { getMaterial } from '../../src/materials/materials';
import { bodyParameters, boxMesh, computePhysicalProperties, PartInput } from '../../src/physics/physical-properties';
import { HavokSim } from './havok-sim';

function hullVolume(p: Float32Array): number {
  const pts: Vector3[] = [];
  for (let i = 0; i < p.length; i += 3) pts.push(new Vector3(p[i], p[i + 1], p[i + 2]));
  const hull = new ConvexHull().setFromPoints(pts);
  let v = 0;
  for (const f of hull.faces) {
    let e = f.edge;
    const a = e.head().point;
    e = e.next;
    do {
      const b = e.tail().point, c = e.head().point;
      v += a.dot(new Vector3().crossVectors(b, c)) / 6;
      e = e.next;
    } while (e !== f.edge);
  }
  return Math.abs(v);
}

/** Lying flat: 25 cm handle along x, a 3x3x9 cm head across z at the +x end. Origin at the handle's far end. */
function hammer(head: string): PartInput[] {
  return [
    { id: 0, materialId: 'wood', positions: boxMesh([0, 0.005, -0.01], [0.25, 0.025, 0.01]) },
    { id: 1, materialId: head, positions: boxMesh([0.25, 0, -0.045], [0.28, 0.03, 0.045]) },
  ];
}

function addHammer(sim: HavokSim, parts: PartInput[], at: [number, number, number]) {
  const props = computePhysicalProperties(parts);
  const all = new Float32Array(parts.reduce((n, p) => n + p.positions.length, 0));
  let o = 0;
  for (const p of parts) all.set(p.positions, (o += p.positions.length) - p.positions.length);
  const bp = bodyParameters(parts, props, hullVolume(all), 'wood', (a, b) => matchup(a, b).friction);
  const h = sim.add({
    shape: { type: 'ConvexHull', vertices: all }, position: at, density: bp.density, centerOfMass: bp.centerOfMass,
    friction: bp.friction, restitution: bp.restitution,
  });
  return { h, props };
}

let sim: HavokSim;
beforeEach(async () => (sim = await HavokSim.create()));
afterEach(() => sim.destroy());

describe('6b: stone-head hammer vs all-wood hammer', () => {
  it('computed numbers: the stone head moves the centre of mass toward the head and adds mass', () => {
    const s = computePhysicalProperties(hammer('stone')), w = computePhysicalProperties(hammer('wood'));
    console.info(`[6b] stone head: ${(s.mass * 1000).toFixed(0)} g, COM x ${(s.com[0] * 100).toFixed(1)} cm · all wood: ${(w.mass * 1000).toFixed(0)} g, COM x ${(w.com[0] * 100).toFixed(1)} cm`);
    expect(s.mass).toBeGreaterThan(w.mass * 2);
    expect(s.com[0]).toBeGreaterThan(w.com[0] + 0.03);
  });

  it('tipping over a table edge matches the computed centre of mass', () => {
    const s = computePhysicalProperties(hammer('stone')), w = computePhysicalProperties(hammer('wood'));
    // table edge between the two centres of mass, head on the table, handle sticking out over the edge
    const edge = (s.com[0] + w.com[0]) / 2;
    const tableHalf = 0.3;
    // a hull table like the game's (IWSDK Box colliders round their edges by ~1.4 cm)
    sim.add({ shape: { type: 'ConvexHull', vertices: boxMesh([edge, -0.03, -0.5], [edge + 2 * tableHalf, 0, 0.5]) }, state: 'STATIC', position: [0, 0, 0], friction: 1, restitution: 0 });
    // hammers are placed so x in body space = x in world space
    const stone = addHammer(sim, hammer('stone'), [0, 0.0005, -0.2]);
    const wood = addHammer(sim, hammer('wood'), [0, 0.0005, 0.2]);
    const predictFalls = (com: number) => com < edge; // COM off the edge -> it tips off
    for (const x of [stone, wood]) sim.setVelocity(x.h, [0, -0.01, 0]);
    sim.seconds(2);
    const fell = (h: number) => sim.get(h).p[1] < -0.05;
    console.info(`[6b] edge x ${(edge * 100).toFixed(1)} cm · stone-head fell: ${fell(stone.h)} (predicted ${predictFalls(s.com[0])}) · all-wood fell: ${fell(wood.h)} (predicted ${predictFalls(w.com[0])})`);
    expect(fell(stone.h)).toBe(predictFalls(s.com[0]));
    expect(fell(wood.h)).toBe(predictFalls(w.com[0]));
    expect(fell(stone.h)).toBe(false);
    expect(fell(wood.h)).toBe(true);
  });

  it('hits differently: the stone-head hammer knocks a block away faster', () => {
    sim.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
    const run = (head: string, z: number) => {
      const hm = addHammer(sim, hammer(head), [-0.31, 0.0005, z]);
      const block = sim.add({ shape: { type: 'Box', size: [0.04, 0.04, 0.04] }, position: [0.02, 0.0205, z], density: 2600, friction: 0.75 }); // a stone block
      return { hm, block };
    };
    const a = run('stone', -0.5), b = run('wood', 0.5);
    sim.step(2);
    for (const x of [a, b]) sim.setVelocity(x.hm.h, [1.5, 0, 0]);
    let maxA = 0, maxB = 0;
    sim.seconds(0.6, () => {
      maxA = Math.max(maxA, Math.hypot(...sim.get(a.block).v));
      maxB = Math.max(maxB, Math.hypot(...sim.get(b.block).v));
    });
    console.info(`[6b] block speed after the hit: stone head ${maxA.toFixed(2)} m/s, all wood ${maxB.toFixed(2)} m/s`);
    expect(maxA).toBeGreaterThan(maxB * 1.2);
  });

  it('hits differently: dropped head-first on a glass ball, the stone head breaks it and the wood head does not', () => {
    // the game's rule: the hit object feels the impactor's impulse / its own mass (ImpactSystem: dv > 0.6 m/s per step)
    sim.add({ shape: { type: 'Box', size: [3, 0.03, 3] }, state: 'STATIC', position: [0, -0.015, 0], friction: 1, restitution: 0 });
    const r = 0.024, glassKg = getMaterial('glass').density * (4 / 3) * Math.PI * r ** 3;
    const drop = (head: string, z: number) => {
      const parts = hammer(head);
      const headCom = computePhysicalProperties(parts).parts[1].com;
      sim.add({ shape: { type: 'Sphere', r }, position: [0, r, z], density: getMaterial('glass').density, friction: 0.4, restitution: 0.15 });
      // head centred over the ball, its underside 15 cm above the ball's top
      const hm = addHammer(sim, parts, [-headCom[0], 2 * r + 0.15, z - headCom[2]]);
      return { head, ...hm, prev: [0, 0, 0], dv: 0 };
    };
    const runs = [drop('stone', -0.4), drop('wood', 0.4)];
    sim.step(1);
    sim.seconds(0.4, () => {
      for (const x of runs) {
        const v = sim.get(x.h).v;
        const dv = Math.hypot(v[0] - x.prev[0], v[1] - x.prev[1], v[2] - x.prev[2]);
        if (!x.dv && dv > 0.6) x.dv = dv; // the first hit
        x.prev = [...v];
      }
    });
    const felt = runs.map((x) => ({ head: x.head, hammerG: Math.round(x.props.mass * 1000), dv: x.dv, felt: feltSpeed('glass', x.head, 0, { impulse: x.props.mass * x.dv, selfMassKg: glassKg }) }));
    console.info(`[6b] onto a ${Math.round(glassKg * 1000)} g glass ball (breaks at ${getMaterial('glass').fragility!.breakSpeed} m/s): ` +
      felt.map((f) => `${f.head} head ${f.hammerG} g, hammer dv ${f.dv.toFixed(2)} -> glass feels ${f.felt.toFixed(2)} m/s`).join(' · '));
    const limit = getMaterial('glass').fragility!.breakSpeed;
    expect(felt[0].felt).toBeGreaterThan(limit);
    expect(felt[1].felt).toBeLessThan(limit);
  });
});
