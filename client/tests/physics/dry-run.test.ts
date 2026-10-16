import { beforeAll, describe, expect, it } from 'vitest';
import { HavokSim } from './havok-sim';
import { TEMPLATES, templateById } from '../../src/playkit/templates';
import { dryRun, sceneFromSpec } from '../../src/sim/dry-run';

beforeAll(async () => (await HavokSim.create()).destroy());

describe("the Referee's dry run in the game's own physics (V5)", () => {
  it('every built-in game passes', async () => {
    for (const t of TEMPLATES) {
      const r = await dryRun(sceneFromSpec(t), t);
      expect(r.problems, t.id).toEqual([]);
    }
  }, 120000);

  it('a game whose pieces cannot stand, or where nothing ever happens, fails with plain reasons', async () => {
    const g = JSON.parse(JSON.stringify(templateById('tower-balance')!));
    const scene = sceneFromSpec(g);
    // a block placed half off the table's edge falls at the start
    scene.pieces.find((p) => !p.fixed)!.p[0] = 0.4;
    const r = await dryRun(scene, g);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/falls off the table|does not stay/);
    // a game with no hand action the demo player can use and nothing to score
    const idle = JSON.parse(JSON.stringify(templateById('knock-down')!));
    idle.allowedActions = ['push'];
    idle.rules = [{ when: { type: 'timer', seconds: 30 }, do: [{ type: 'lose' }] }];
    idle.counter = undefined;
    const r2 = await dryRun(sceneFromSpec(idle), idle, 7, 10);
    expect(r2.ok).toBe(false);
  }, 120000);
});
