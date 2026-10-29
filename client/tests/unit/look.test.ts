import { describe, expect, it } from 'vitest';
import { explain, lookAt } from '../../src/game-agent/look';
import { playable } from '../../src/game-agent/adjust';
import { validateSpec } from '../../src/playkit/game-spec';
import { TEMPLATES } from '../../src/playkit/templates';
import type { KitStats } from '../../src/playkit/kit-store';

const stats = (sizeCm: [number, number, number], fill: number, massKg = 0.2): KitStats => ({ sizeCm, fill, massKg, materials: ['clay'], parts: 1 });

describe('Make it a game: the agent looks at one creation (V6, 4.2)', () => {
  it('a small round lump is the ball', () => {
    const l = lookAt('Pebble', stats([6, 5.6, 6], 0.52), [{ materialId: 'clay', massKg: 0.2 }]);
    expect(l.role).toBe('ball');
    expect(l.spec.roles.find((r) => r.id === 'ball')!.label).toBe('Pebble');
    expect(l.why).toMatch(/rolls/);
  });

  it('a hollow shape is the cup, with its inside as the zone', () => {
    const l = lookAt('Bowl', stats([10, 6, 10], 0.3), [{ materialId: 'stone', massKg: 0.4 }]);
    expect(l.role).toBe('cup');
    expect(l.spec.zones[0].size[0]).toBeCloseTo(0.04, 3);
    expect(l.seen.join(' ')).toMatch(/Hollow/);
  });

  it('anything else is the target to knock over (the default lump)', () => {
    const l = lookAt('Clay 1', stats([17, 10, 11], 0.6, 0.66), [{ materialId: 'clay', massKg: 0.5 }, { materialId: 'wood', massKg: 0.16 }]);
    expect(l.role).toBe('target');
    expect(l.seen[0]).toBe('Clay 1: 17 cm wide, 10 cm tall, 11 cm deep, 660 g');
    expect(l.seen[1]).toBe('2 pieces: 1 clay, 1 wood');
    expect(l.rule).toBe('Hit your Clay 1 with a ball (1 point), knock it over to win: 3 throws.');
    expect(explain(l.spec)).toContain('When the Clay 1 tips over (more than 45°), you score 3.');
  });

  it('every game it makes is a valid, winnable Game Spec', () => {
    for (const [size, fill] of [[[6, 6, 6], 0.52], [[10, 6, 10], 0.3], [[17, 10, 11], 0.6], [[40, 30, 30], 0.9]] as const) {
      const l = lookAt('A very long creation name indeed', stats([...size] as [number, number, number], fill), []);
      expect(validateSpec(l.spec)).toEqual([]);
      expect(playable(l.spec)).toEqual([]);
      expect(l.spec.roles.some((r) => r.id === l.role)).toBe(true);
    }
  });
});

describe('explain mode: any game in plain sentences', () => {
  it('says each rule and the turns', () => {
    const k = TEMPLATES.find((t) => t.id === 'knock-down')!;
    const lines = explain(k);
    expect(lines[0]).toBe('On the table: 6 × blocks, 3 × balls.');
    expect(lines).toContain('When one of the blocks falls 2 cm or more, you score 1.');
    expect(lines).toContain('When blocks down reaches 6, you win.');
    expect(lines).toContain('Each turn you have 3 throws, 1 turn each.');
  });

  it('a points game says how it ends; the uses lines replace the role list', () => {
    const t = TEMPLATES.find((x) => x.id === 'target-throw')!;
    const lines = explain(t, ['Cups: your Bowl', 'Balls: built-in ball']);
    expect(lines[0]).toBe('On the table: Cups: your Bowl; Balls: built-in ball.');
    expect(lines.at(-1)).toBe('When the throws run out, the most points wins.');
  });
});
