import { describe, expect, it } from 'vitest';
import { validateSpec } from '../../src/playkit/game-spec';
import { templateById } from '../../src/playkit/templates';
import { applyNumbers, numbersOf, playable, rulesInWords } from '../../src/game-agent/adjust';

describe('rules card (Adjust)', () => {
  it('reads the numbers of a game', () => {
    expect(numbersOf(templateById('knock-down')!)).toEqual({ players: 1, maxTurns: 1, shotsPerTurn: 3, target: 6, timerSec: 0 });
    expect(numbersOf(templateById('marble-run')!).timerSec).toBe(60);
  });

  it('applies players, turns, target and time, then checks it again', () => {
    const { spec, problems } = applyNumbers(templateById('knock-down')!, { players: 2, maxTurns: 3, shotsPerTurn: 1, target: 4, timerSec: 0 });
    expect(problems).toEqual([]);
    expect([spec.players, spec.maxTurns, spec.shotsPerTurn, spec.counter?.target]).toEqual([2, 3, 1, 4]);
    expect(spec.rules.find((r) => r.when.type === 'count_reached')!.when).toMatchObject({ value: 4 });
    const timed = applyNumbers(templateById('marble-run')!, { players: 1, maxTurns: 0, shotsPerTurn: 0, target: 3, timerSec: 30 }).spec;
    expect(timed.rules.find((r) => r.when.type === 'timer')!.when).toMatchObject({ seconds: 30 });
  });

  it('refuses a win that can never happen, and a game that never ends', () => {
    expect(applyNumbers(templateById('knock-down')!, { players: 1, maxTurns: 1, shotsPerTurn: 3, target: 9, timerSec: 0 }).problems[0]).toMatch(/only 6/);
    const never = applyNumbers(templateById('tower-balance')!, { players: 1, maxTurns: 0, shotsPerTurn: 0, target: 0, timerSec: 0 });
    expect(never.problems).toEqual([]); // tower balance still ends by its win / lose rules
    expect(playable(templateById('flick-and-pocket')!)).toEqual([]); // respawning coins can always reach 6
    expect(validateSpec(applyNumbers(templateById('target-throw')!, numbersOf(templateById('target-throw')!)).spec)).toEqual([]);
  });

  it('puts the numbers in words for the Designer', () => {
    expect(rulesInWords({ players: 2, maxTurns: 3, shotsPerTurn: 1, target: 5, timerSec: 60 }, 'bigger pocket scores more')).toBe(
      '2 players, 1 shot per turn, 3 turns each, first to 5 wins, 60 second time limit, bigger pocket scores more',
    );
  });
});
