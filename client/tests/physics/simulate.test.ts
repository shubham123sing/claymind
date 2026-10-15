import { beforeAll, describe, expect, it } from 'vitest';
import { HavokSim } from './havok-sim';
import { templateById } from '../../src/playkit/templates';
import { fallbackParts, bottomOf } from '../../src/playkit/fallback-shapes';
import { runGame, sceneFromSpec, stability, suggestFix, variantScene, whatIf, whatIfOptions, type SimScene } from '../../src/sim/runs';
import type { SimPiece } from '../../src/sim/headless-sim';

// HavokSim.create patches fetch so Havok's .wasm loads from disk in Node
beforeAll(async () => (await HavokSim.create()).destroy());

const TABLE = { cx: 0, cz: 0, halfW: 0.4, halfD: 0.25, yaw: 0, floorY: -0.72 };

function tower(offsets: number[]): SimScene {
  const parts = fallbackParts('block', 'wood');
  const b = bottomOf(parts);
  const pieces: SimPiece[] = offsets.map((dx, i) => ({ key: `block:${i}`, role: 'block', parts, p: [dx, i * 0.04 - b + 0.0005, 0], q: [0, 0, 0, 1], fixed: false }));
  return { table: TABLE, pieces };
}

describe('Simulate it for me (headless, no AI, no network)', () => {
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

  it('"Will it work?": a straight tower stands, a leaning one falls, and the fix is proven', async () => {
    const good = await stability(tower([0, 0, 0, 0]));
    expect(good.ok).toBe(true);
    const leaning = tower([0, 0.012, 0.024, 0.036]);
    const bad = await stability(leaning);
    expect(bad.ok).toBe(false);
    expect(bad.moved.length).toBeGreaterThan(0);
    const fix = await suggestFix(leaning);
    expect(fix?.label).toMatch(/Line the pieces up/);
    const fixed = { ...leaning, pieces: leaning.pieces.map((p) => (fix!.poses[p.key] ? { ...p, p: fix!.poses[p.key].p } : p)) };
    expect((await stability(fixed)).ok).toBe(true);
  }, 60000);

  it('What-if: a better ball for Knock-down, the same result on replay', async () => {
    const spec = templateById('knock-down')!;
    const opt = whatIfOptions(spec).find((o) => o.role === 'ball')!;
    expect(opt.values.length).toBeGreaterThanOrEqual(5);
    const r = await whatIf(sceneFromSpec(spec), spec, opt, 11);
    expect(r.variants).toHaveLength(opt.values.length);
    expect(r.replayIdentical).toBe(true);
    const down = (v: (typeof r.variants)[number]) => v.run.counters.down ?? 0;
    expect(down(r.best)).toBeGreaterThanOrEqual(Math.max(...r.variants.map(down)));
    expect(down(r.best)).toBeGreaterThanOrEqual(down(r.current!));
  }, 120000);

  it('What-if: light foam balls get a better (heavier) ball, the same result on replay', async () => {
    const spec = templateById('knock-down')!;
    const opt = whatIfOptions(spec).find((o) => o.role === 'ball')!;
    const scene = variantScene(sceneFromSpec(spec), opt, 'foam');
    const r = await whatIf(scene, spec, opt, 7);
    expect(r.current?.value).toBe('foam');
    expect(r.best.value).not.toBe('foam');
    expect(r.best.run.counters.down ?? 0).toBeGreaterThan(r.current!.run.counters.down ?? 0);
    expect(r.replayIdentical).toBe(true);
  }, 120000);
});
