import { describe, expect, it } from 'vitest';
import { getMaterial } from '../../src/materials/materials';
import { matchup } from '../../src/materials/matchups';
import { boxMesh, computePhysicalProperties } from '../../src/physics/physical-properties';

const rho = (id: string) => getMaterial(id).density;

describe('computePhysicalProperties', () => {
  it('a 10 cm wood cube: exact volume, mass, centre and inertia; it stands', () => {
    const p = computePhysicalProperties([{ id: 0, materialId: 'wood', positions: boxMesh([-0.05, 0, -0.05], [0.05, 0.1, 0.05]) }]);
    expect(p.volume).toBeCloseTo(0.001, 6);
    expect(p.mass).toBeCloseTo(rho('wood') * 0.001, 6);
    expect(p.com[0]).toBeCloseTo(0, 6);
    expect(p.com[1]).toBeCloseTo(0.05, 6);
    const i = (p.mass * (0.1 ** 2 + 0.1 ** 2)) / 12;
    expect(p.inertia[0]).toBeCloseTo(i, 6);
    expect(p.inertia[1]).toBeCloseTo(i, 6);
    expect(p.inertia[3]).toBeCloseTo(0, 6);
    expect(p.support.area).toBeCloseTo(0.01, 6);
    expect(p.support.margin).toBeCloseTo(0.05, 6);
  });

  it('two equal cubes, steel beside wood: the centre of mass shifts toward the steel', () => {
    const steel = { id: 0, materialId: 'steel', positions: boxMesh([-0.1, 0, -0.05], [0, 0.1, 0.05]) };
    const wood = { id: 1, materialId: 'wood', positions: boxMesh([0, 0, -0.05], [0.1, 0.1, 0.05]) };
    const p = computePhysicalProperties([steel, wood]);
    const expected = (rho('steel') * -0.05 + rho('wood') * 0.05) / (rho('steel') + rho('wood'));
    expect(p.com[0]).toBeCloseTo(expected, 6);
    expect(p.com[0]).toBeLessThan(-0.04);
    expect(p.parts[0].mass / p.parts[1].mass).toBeCloseTo(rho('steel') / rho('wood'), 6);
    expect(p.mass).toBeCloseTo(p.parts[0].mass + p.parts[1].mass, 6);
    // the same two cubes all wood: centred
    expect(computePhysicalProperties([{ ...steel, materialId: 'wood' }, wood]).com[0]).toBeCloseTo(0, 6);
  });

  it('an L shape stands; an overhanging arm tips it unless the arm is light enough', () => {
    // L: foot along x on the table, upright bar at its left end
    const foot = { id: 0, materialId: 'wood', positions: boxMesh([0, 0, -0.01], [0.1, 0.02, 0.01]) };
    const bar = { id: 1, materialId: 'wood', positions: boxMesh([0, 0.02, -0.01], [0.02, 0.12, 0.01]) };
    const L = computePhysicalProperties([foot, bar]);
    expect(L.com[0]).toBeCloseTo(0.03, 6);
    expect(L.support.margin).toBeGreaterThan(0);
    expect(L.support.area).toBeCloseTo(0.1 * 0.02, 6);

    // Γ: an upright post (on the table) with an arm overhanging at the top
    const post = (m: string) => ({ id: 0, materialId: m, positions: boxMesh([0, 0, -0.01], [0.02, 0.12, 0.01]) });
    const arm = (m: string) => ({ id: 1, materialId: m, positions: boxMesh([0.02, 0.1, -0.01], [0.12, 0.12, 0.01]) });
    const allWood = computePhysicalProperties([post('wood'), arm('wood')]);
    expect(allWood.support.margin).toBeLessThan(0);
    expect(allWood.support.tipDir[0]).toBeCloseTo(1, 6);
    const heavyBase = computePhysicalProperties([post('steel'), arm('foam')]);
    expect(heavyBase.support.margin).toBeGreaterThan(0);
  });

  it('a pyramid: volume b²h/3 and centre of mass at h/4', () => {
    const b = 0.1, h = 0.1, s = b / 2;
    const A = [-s, 0, -s], B = [s, 0, -s], C = [s, 0, s], D = [-s, 0, s], T = [0, h, 0];
    const tris = [A, B, C, A, C, D, A, T, B, B, T, C, C, T, D, D, T, A];
    // base faces down (-y): A,B,C must be clockwise seen from above -> check sign and flip if needed
    const p = computePhysicalProperties([{ id: 0, materialId: 'stone', positions: new Float32Array(tris.flat()) }]);
    expect(p.volume).toBeCloseTo((b * b * h) / 3, 6);
    expect(p.com[1]).toBeCloseTo(h / 4, 6);
    expect(p.com[0]).toBeCloseTo(0, 6);
    expect(p.support.area).toBeCloseTo(b * b, 6);
  });

  it('orientation: a cube balanced on an edge has no contact area and no margin', () => {
    const s = Math.SQRT1_2;
    const q: [number, number, number, number] = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]; // 45° about z
    const p = computePhysicalProperties([{ id: 0, materialId: 'wood', positions: boxMesh([-0.05, -0.05, -0.05], [0.05, 0.05, 0.05]) }], q);
    void s;
    expect(p.support.area).toBeCloseTo(0, 6);
    expect(Math.abs(p.support.margin)).toBeLessThan(1e-6);
  });
});

describe('matchups', () => {
  it('glass suffers hitting steel; steel barely notices; foam cushions', () => {
    expect(matchup('glass', 'steel').damage).toBeGreaterThan(1);
    expect(matchup('steel', 'glass').damage).toBeLessThan(1);
    expect(matchup('glass', 'foam').damage).toBeLessThan(0.5);
    expect(matchup('rubber', 'wood').friction).toBeGreaterThan(1);
    expect(matchup('wood', 'rubber').friction).toBe(matchup('rubber', 'wood').friction);
    expect(matchup('plastic', 'wood')).toEqual({ damage: 1, friction: 1, otherSound: 0.4 });
    expect(matchup('ceramic', 'steel').damage).toBe(matchup('stone', 'steel').damage); // old id
  });
});
