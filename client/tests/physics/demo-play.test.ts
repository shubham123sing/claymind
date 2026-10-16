import { beforeAll, describe, expect, it } from 'vitest';
import { HavokSim } from './havok-sim';
import { templateById } from '../../src/playkit/templates';
import { runGame, sceneFromSpec } from '../../src/sim/dry-run';

// HavokSim.create patches fetch so Havok's .wasm loads from disk in Node
beforeAll(async () => (await HavokSim.create()).destroy());

describe('Show me how: the demo planner plays the games (headless, no AI, no network)', () => {
  it('"Show me how to play": a full Knock-down, and the same seed replays identically', async () => {
    const spec = templateById('knock-down')!;
    const a = await runGame(sceneFromSpec(spec), spec, 7);
    expect(a.actions).toBe(3); // three balls thrown
    expect(a.counters.down ?? 0).toBeGreaterThan(0);
    expect(['win', 'done']).toContain(a.result);
    const b = await runGame(sceneFromSpec(spec), spec, 7);
    expect(b.hash).toBe(a.hash);
    expect(b.scores).toEqual(a.scores);
  }, 60000);

  it('"Show me how to play": Flick-and-pocket runs turns for both players', async () => {
    const spec = templateById('flick-and-pocket')!;
    const r = await runGame(sceneFromSpec(spec), spec, 3, 40);
    expect(r.actions).toBeGreaterThanOrEqual(4);
    expect(r.result).not.toBe('lose');
  }, 60000);
});
