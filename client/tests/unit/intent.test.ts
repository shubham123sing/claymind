import { describe, expect, it } from 'vitest';
import { bind, bindOrdered, type Attention, type Word } from '../../src/game-agent/binder';
import { applyIntent, chooseGame, rolesFromWords, tagged, type Intent } from '../../src/game-agent/intent';
import type { Mark } from '../../src/game-agent/marks';
import { validateSpec } from '../../src/playkit/game-spec';
import { TEMPLATES } from '../../src/playkit/templates';

const say = (s: string, t0 = 1000, step = 150): Word[] => s.split(' ').map((text, i) => ({ text, t: t0 + i * step }));
const zone = (id: string, x: number, z: number, r = 0.06): Mark => ({ id, kind: 'zone', points: [], center: [x, 0, z], radius: r });
const intent = (p: Partial<Intent>): Intent => ({ roles: [], zones: [], paths: [], text: '', ...p });

describe('Point + Say intent', () => {
  it('reads the role next to each pointing word (English and Hinglish)', () => {
    const w = say('this is the ball and these are the pins');
    const r = bind(w, [{ t: 1000, gesture: 'hold', itemId: 'toy:A' }, { t: 1700, gesture: 'point', itemId: 'toy:P1' }, { t: 1800, gesture: 'point', itemId: 'toy:P2' }]);
    expect(rolesFromWords(w, r).roles).toEqual([{ role: 'ball', items: ['toy:A'] }, { role: 'target', items: ['toy:P1', 'toy:P2'] }]);
    const h = say('yeh gend hai');
    expect(rolesFromWords(h, bind(h, [{ t: 950, gesture: 'point', itemId: 'c:X' }])).roles).toEqual([{ role: 'ball', items: ['c:X'] }]);
  });

  it('a zone said with "here" is the goal', () => {
    const w = say('the goal is here');
    const r = bind(w, [{ t: 1500, gesture: 'zone', zone: 'z1' }]);
    expect(rolesFromWords(w, r).goal).toBe('z1');
  });

  it('typed text binds in the order things were shown', () => {
    const att: Attention[] = [{ t: 1, gesture: 'point', itemId: 'A' }, { t: 2, gesture: 'point', itemId: 'B' }, { t: 3, gesture: 'point', itemId: 'C' }, { t: 4, gesture: 'zone', zone: 'z1' }];
    const w = say('knock these down with this into here');
    const r = bindOrdered(w, att);
    expect(r.bindings.map((b) => b.ids)).toEqual([['A', 'B'], ['C'], ['z1']]);
    expect(rolesFromWords(say('this is the ball'), bindOrdered(say('this is the ball'), att)).roles).toEqual([{ role: 'ball', items: ['A'] }]);
  });

  it('picks the built-in game that fits the roles shown', () => {
    expect(chooseGame(intent({ roles: [{ role: 'ball', items: ['a'] }, { role: 'goal', items: ['c'] }] }), TEMPLATES)?.spec.id).toBe('target-throw');
    expect(chooseGame(intent({ roles: [{ role: 'launcher', items: ['s'] }, { role: 'ball', items: ['a'] }, { role: 'board', items: ['b'] }] }), TEMPLATES)?.spec.id).toBe('flick-and-pocket');
    expect(chooseGame(intent({ roles: [{ role: 'ball', items: ['a'] }, { role: 'target', items: ['p'] }] }), TEMPLATES)?.spec.id).toBe('knock-down');
    expect(chooseGame(intent({ text: 'marble run please' }), TEMPLATES)?.spec.id).toBe('marble-run');
    // the e2e case: a ball chip, a target chip, "knock them down" (sent to the agent as the game's name)
    expect(chooseGame(intent({ text: 'knock them down', roles: [{ role: 'ball', items: ['a'] }, { role: 'target', items: ['p'] }] }), TEMPLATES)?.spec.name).toBe('Knock-down');
    expect(chooseGame(intent({}), TEMPLATES)).toBeNull();
  });

  it('applies the toys and the marks; every template stays valid', () => {
    const marble = TEMPLATES.find((t) => t.id === 'marble-run')!;
    const r = applyIntent(marble, intent({ roles: [{ role: 'ball', items: ['toy:1'] }], zones: [zone('z1', 0.1, 0.05)], goal: 'z1' }), (k) => (k === 'toy:1' ? 'kit_red' : null));
    expect(r.problems).toEqual([]);
    expect(r.roleMap).toEqual({ marble: 'kit_red' });
    expect(r.spec.zones[0]).toMatchObject({ id: 'finish', shape: 'cylinder', center: [0.1, 0.025, 0.05], size: [0.06, 0.05, 0] });
    expect(r.spec.id).toBe('marble-run-yours');
    for (const t of TEMPLATES) {
      const a = applyIntent(t, intent({ zones: [zone('z1', -0.1, 0.1)], paths: [{ id: 'p1', kind: 'path', points: [[0, 0, 0], [0.1, 0, 0.1]], center: [0, 0, 0], radius: 0 }] }), () => null);
      expect(a.problems, t.id).toEqual([]);
      expect(validateSpec(a.spec)).toEqual([]);
    }
  });

  it('a game with no zone gets the goal as a scoring zone', () => {
    const knock = TEMPLATES.find((t) => t.id === 'knock-down')!;
    expect(knock.zones.length).toBe(0);
    const r = applyIntent(knock, intent({ roles: [{ role: 'ball', items: ['b'] }], zones: [zone('z1', 0, 0.2)] }), () => null);
    expect(r.problems).toEqual([]);
    expect(r.spec.rules.at(-1)).toMatchObject({ when: { type: 'enters_zone', zone: 'goal', role: 'ball' } });
  });

  it('an unused role is said plainly', () => {
    const knock = TEMPLATES.find((t) => t.id === 'knock-down')!;
    expect(applyIntent(knock, intent({ roles: [{ role: 'tool', items: ['x'] }] }), () => null).notes).toEqual(['This game has no tool: that one is not used']);
  });

  it('items pointed at but not named go to the Intent Resolver as tags', () => {
    const att: Attention[] = [{ t: 1, gesture: 'point', itemId: 'toy:a' }, { t: 2, gesture: 'point', itemId: 'toy:b' }, { t: 3, gesture: 'point', itemId: 'toy:c' }];
    const w = say('flick this so it knocks those off');
    const b = bindOrdered(w, att);
    const got = rolesFromWords(w, b);
    // "flick this": a ball; "it" and "those" are left to the Intent Resolver
    expect(got.roles).toEqual([{ role: 'ball', items: ['toy:a'] }]);
    expect(got.unnamed.length).toBe(2);
    const t = tagged(w, b.bindings, (k) => `item ${k}`);
    expect(t.text).toBe('flick [A] so [B] knocks [C] off');
    expect(t.items).toEqual({ A: 'item toy:a', B: 'item toy:b', C: 'item toy:c' });
    expect(t.refs.C).toBe('toy:c');
  });

  it('typing with a piece in the hand: "this" is that piece, whatever was shown first', () => {
    const att: Attention[] = [{ t: 1, gesture: 'point', itemId: 'cup1' }, { t: 2, gesture: 'point', itemId: 'cup2' }, { t: 3, gesture: 'hold', itemId: 'ball' }];
    const w = say('throw this into those');
    expect(bindOrdered(w, att).bindings.map((b) => b.ids)).toEqual([['cup1'], ['cup2', 'ball']]);
    expect(bindOrdered(w, att, undefined, 'ball').bindings.map((b) => b.ids)).toEqual([['ball'], ['cup1', 'cup2']]);
  });
});
