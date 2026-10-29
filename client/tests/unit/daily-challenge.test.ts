import { describe, expect, it } from 'vitest';
import { challengeFor, CHALLENGES, complete, dayKey, meets, rollOver } from '../../src/core/daily-challenge.js';

describe('daily challenge', () => {
  it('is picked from the date alone and never repeats two days in a row', () => {
    expect(challengeFor('2026-11-01')).toEqual(challengeFor('2026-11-01'));
    const seen = new Set<string>();
    let prev = '';
    for (let d = 1; d <= 30; d++) {
      const id = challengeFor(`2026-11-${String(d).padStart(2, '0')}`).id;
      expect(id).not.toBe(prev);
      seen.add(id);
      prev = id;
    }
    expect(seen.size).toBe(CHALLENGES.length);
    // across a month and a year boundary too
    expect(challengeFor('2026-12-31').id).not.toBe(challengeFor('2027-01-01').id);
  });

  it('uses the local calendar day', () => {
    expect(dayKey(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03');
  });

  it('checks each goal from what happened', () => {
    expect(meets('tower', { kind: 'creation', parts: 1, materials: 1, heightCm: 21 })).toBe(true);
    expect(meets('tower', { kind: 'creation', parts: 1, materials: 1, heightCm: 12 })).toBe(false);
    expect(meets('parts3', { kind: 'creation', parts: 3, materials: 1, heightCm: 5 })).toBe(true);
    expect(meets('twoMaterials', { kind: 'creation', parts: 2, materials: 2, heightCm: 5 })).toBe(true);
    expect(meets('throwHard', { kind: 'throw', speed: 1 })).toBe(false);
    expect(meets('throwHard', { kind: 'throw', speed: 3 })).toBe(true);
    expect(meets('score3', { kind: 'game', result: 'lose', score: 3 })).toBe(true);
    expect(meets('win', { kind: 'game', result: 'done', score: 9 })).toBe(false);
    expect(meets('win', { kind: 'throw', speed: 9 })).toBe(false);
  });

  it('keeps a streak over days in a row and breaks it on a missed day', () => {
    let s = rollOver(undefined, '2026-11-01');
    s = complete(s);
    expect(s).toMatchObject({ done: true, streak: 1 });
    expect(complete(s)).toBe(s); // once a day
    s = complete(rollOver(s, '2026-11-02'));
    expect(s.streak).toBe(2);
    const next = rollOver(s, '2026-11-03');
    expect(next).toMatchObject({ done: false, streak: 2 });
    expect(rollOver(s, '2026-11-05').streak).toBe(0);
    expect(complete(rollOver(s, '2026-11-05')).streak).toBe(1);
  });
});
