import { describe, expect, it } from 'vitest';
import { PokeGate } from '../../src/platform/input/poke-gate';

/** Feed a path of [z (m), button] samples, one every `dt` ms; returns the presses. */
function run(gate: PokeGate, path: [number, string | null, boolean?][], dt = 14, t0 = 1000): string[] {
  const out: string[] = [];
  path.forEach(([z, id, inside = true], i) => {
    const p = gate.update(inside, z, id, t0 + i * dt);
    if (p) out.push(p);
  });
  return out;
}

const approach = (id: string, frames = 6): [number, string][] => Array.from({ length: frames }, (_, i) => [0.06 - i * 0.009, id]);

describe('poke intent (V6, 4.3)', () => {
  it('a straight push from the front presses once', () => {
    const g = new PokeGate();
    expect(run(g, [...approach('a'), [-0.005, 'a'], [-0.01, 'a'], [-0.008, 'a'], [0.02, 'a']])).toEqual(['a']);
  });

  it('a quick brush (no steady aim) presses nothing', () => {
    const g = new PokeGate();
    expect(run(g, [[0.02, 'a'], [-0.005, 'a']])).toEqual([]);
    expect(g.refused).toBe(1);
  });

  it('a hand sliding in from the side behind the panel presses nothing', () => {
    const g = new PokeGate();
    expect(run(g, [[-0.005, null, false], [-0.005, null, false], [-0.005, 'a'], [-0.004, 'a'], [-0.006, 'b']])).toEqual([]);
  });

  it('sliding across buttons in front, then pushing: only a steady aim on the pushed button counts', () => {
    const g = new PokeGate();
    // aims at a, slides to b and pushes at once: b was not aimed long enough
    expect(run(g, [...approach('a'), [0.012, 'b'], [-0.004, 'b']])).toEqual([]);
    // aims at b and pushes
    expect(run(g, [...approach('b'), [-0.004, 'b']], 14, 5000)).toEqual(['b']);
  });

  it('a pinching hand never presses', () => {
    const g = new PokeGate();
    const t = 1000;
    for (let i = 0; i < 6; i++) g.update(true, 0.05 - i * 0.008, 'a', t + i * 14, true);
    expect(g.update(true, -0.005, 'a', t + 100, true)).toBeNull();
  });

  it('going right through (deeper than 2 cm in one step) does not press; nor does a second push within the cooldown', () => {
    const g = new PokeGate();
    expect(run(g, [...approach('a'), [-0.03, 'a']])).toEqual([]);
    const h = new PokeGate();
    expect(run(h, [...approach('a'), [-0.005, 'a'], ...approach('a', 5), [-0.005, 'a']])).toEqual(['a']);
  });
});
