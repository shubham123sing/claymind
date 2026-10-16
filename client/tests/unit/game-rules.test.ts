import { describe, expect, it } from 'vitest';
import { validateSpec, type GameSpec } from '../../src/playkit/game-spec';
import { RuleEngine, type Observation, type PieceObs } from '../../src/playkit/rule-engine';
import { TEMPLATES, templateById } from '../../src/playkit/templates';

const clone = (g: GameSpec): GameSpec => JSON.parse(JSON.stringify(g));
const piece = (key: string, p: [number, number, number], o: Partial<PieceObs> = {}): PieceObs => ({ key, role: key.split(':')[0], p, top: p[1] + 0.02, speed: 0, held: false, ...o });
const obs = (pieces: PieceObs[], o: Partial<Observation> = {}): Observation => ({ pieces, contacts: [], shots: [], ...o });

describe('Game Spec validation', () => {
  it('all five built-in games are valid', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['knock-down', 'flick-and-pocket', 'target-throw', 'tower-balance', 'marble-run']);
    for (const t of TEMPLATES) expect(validateSpec(t), t.id).toEqual([]);
  });

  it('refuses unknown triggers / actions, missing roles and zones, and games that never end', () => {
    const g = clone(templateById('knock-down')!);
    (g.rules[0].when as { type: string }).type = 'run_code';
    expect(validateSpec(g).join()).toMatch(/unknown trigger/);
    const h = clone(templateById('target-throw')!);
    h.rules[0].do = [{ type: 'eval' } as never];
    expect(validateSpec(h).join()).toMatch(/unknown action/);
    const z = clone(templateById('flick-and-pocket')!);
    (z.rules[0].when as { zone: string }).zone = 'nowhere';
    expect(validateSpec(z).join()).toMatch(/unknown zone/);
    const r = clone(templateById('tower-balance')!);
    r.layout.pop();
    expect(validateSpec(r).join()).toMatch(/needs exactly 8/);
    const never = clone(templateById('tower-balance')!);
    never.rules = [never.rules[0]];
    expect(validateSpec(never).join()).toMatch(/never end/);
    const far = clone(templateById('marble-run')!);
    far.layout[0].at = [3, 0, 0];
    expect(validateSpec(far).join()).toMatch(/off the table/);
    expect(validateSpec({ hello: 1 })).not.toEqual([]);
  });
});

describe('rule engine', () => {
  it('Knock-down: fallen blocks count, all six down wins', () => {
    const e = new RuleEngine(templateById('knock-down')!);
    const blocks = (fallen: number) => Array.from({ length: 6 }, (_, i) => piece(`block:${i}`, [0, i < fallen ? 0.02 : 0.06 + i * 0.001, -0.28]));
    e.tick(1 / 30, obs(blocks(0)));
    e.tick(1 / 30, obs(blocks(2)));
    expect(e.state.scores[0]).toBe(2);
    expect(e.state.counters.down).toBe(2);
    e.tick(1 / 30, obs(blocks(2))); // no double count
    expect(e.state.scores[0]).toBe(2);
    e.tick(1 / 30, obs(blocks(6)));
    e.tick(1 / 30, obs(blocks(6)));
    expect(e.state.over).toBe(true);
    expect(e.state.result).toBe('win');
    expect(e.state.message).toBe('All down!');
  });

  it('turns end after the shots once everything rests; the game ends after the last turn', () => {
    const e = new RuleEngine(templateById('knock-down')!);
    const ball = (speed: number) => [piece('ball:0', [0, 0.02, 0], { speed })];
    e.tick(0.1, obs(ball(0)));
    e.tick(0.1, obs(ball(2), { shots: ['ball:0', 'ball:0', 'ball:0'] }));
    expect(e.state.shotsThisTurn).toBe(3);
    for (let i = 0; i < 3; i++) e.tick(0.1, obs(ball(1)));
    expect(e.state.over).toBe(false); // still rolling
    for (let i = 0; i < 8; i++) e.tick(0.1, obs(ball(0)));
    expect(e.state.over).toBe(true);
    expect(e.state.result).toBe('done');
  });

  it('Flick-and-pocket: a coin entering a pocket scores and is respawned; players alternate', () => {
    const g = templateById('flick-and-pocket')!;
    const e = new RuleEngine(g);
    const pocket = g.zones[1].center, start = g.layout.find((l) => l.role === 'coin')!.at;
    const coin = (x: number, z: number, held = false) => [piece('coin:0', [x, 0.015, z], { held }), piece('striker:0', [0, 0.015, 0], {})];
    e.tick(0.1, obs(coin(start[0], start[2])));
    const cmds = e.tick(0.1, obs(coin(pocket[0], pocket[2]), { shots: ['striker:0'] }));
    expect(e.state.scores[0]).toBe(1);
    expect(cmds).toContainEqual({ type: 'respawn', key: 'coin:0' });
    for (let i = 0; i < 8; i++) e.tick(0.1, obs(coin(0.25, -0.18)));
    expect(e.state.player).toBe(1);
  });

  it('carrying a piece in and out of a zone is not "leaving" it; falling out is', () => {
    const e = new RuleEngine(templateById('tower-balance')!);
    const b = (p: [number, number, number], held = false) => [piece('block:0', p, { held })];
    e.tick(0.1, obs(b([0, 0.02, 0.08])));
    e.tick(0.1, obs(b([0, 0.05, -0.16], true)));
    e.tick(0.1, obs(b([0, 0.05, 0.08], true))); // lifted back out while held
    expect(e.state.over).toBe(false);
    e.tick(0.1, obs(b([0, 0.02, -0.16])));
    expect(e.state.counters.stacked).toBe(1);
    e.tick(0.1, obs(b([0.2, 0.02, -0.16])));
    expect(e.state.result).toBe('lose');
  });

  it('stack height, timer and hits', () => {
    const t = new RuleEngine(templateById('tower-balance')!);
    t.tick(0.1, obs([piece('block:0', [0, 0.14, -0.16], { top: 0.16 })]));
    expect(t.state.result).toBe('win');
    const m = new RuleEngine(templateById('marble-run')!);
    for (let i = 0; i < 601; i++) m.tick(0.1, obs([piece('marble:0', [0.2, 0.01, 0.06])]));
    expect(m.state.result).toBe('lose');
    const g = clone(templateById('knock-down')!);
    g.rules = [{ when: { type: 'hit_by', role: 'block', by: 'ball' }, do: [{ type: 'add_score', points: 5 }] }, ...g.rules];
    const h = new RuleEngine(g);
    const ps = [piece('block:0', [0, 0.06, -0.28]), piece('ball:0', [0, 0.06, -0.25])];
    h.tick(0.1, obs(ps, { contacts: [['ball:0', 'block:0']] }));
    h.tick(0.1, obs(ps, { contacts: [['ball:0', 'block:0']] })); // cooldown: once
    expect(h.state.scores[0]).toBe(5);
  });

  it('is deterministic: the same observations give the same game', () => {
    const run = () => {
      const e = new RuleEngine(templateById('flick-and-pocket')!);
      const log: string[] = [];
      for (let i = 0; i < 40; i++) {
        const x = Math.sin(i) * 0.15, z = -0.12 + Math.cos(i * 1.3) * 0.15;
        for (const c of e.tick(0.05, obs([piece('coin:0', [x, 0.015, z], { speed: i % 7 === 0 ? 0 : 0.5 })], { shots: i % 9 === 0 ? ['coin:0'] : [] }))) log.push(JSON.stringify(c));
      }
      return JSON.stringify(e.state) + log.join();
    };
    expect(run()).toBe(run());
  });
});

describe('room games (Update 3, Step C)', () => {
  it('Knock-down for two: named turns, the tower is reset for the second player, scores per player', () => {
    const g = clone(templateById('knock-down')!);
    g.players = 2;
    g.resetEachTurn = true;
    expect(validateSpec(g)).toEqual([]);
    const e = new RuleEngine(g);
    e.names = ['Ana', 'Ben'];
    const blocks = (fallen: number) => [0, 1, 2, 3, 4, 5].map((i) => piece(`block:${i}`, [i * 0.04, i < fallen ? -0.2 : 0.02, 0]));
    const balls = [0, 1, 2].map((i) => piece(`ball:${i}`, [i * 0.05, 0.02, 0.15]));
    e.tick(0.1, obs([...blocks(0), ...balls]));
    e.tick(0.1, obs([...blocks(0), ...balls], { shots: ['ball:0', 'ball:1', 'ball:2'] }));
    let out: ReturnType<RuleEngine['tick']> = [];
    for (let i = 0; i < 40 && !out.some((c) => c.type === 'message'); i++) out = e.tick(0.1, obs([...blocks(2), ...balls]));
    expect(e.state.scores).toEqual([2, 0]);
    expect(out.filter((c) => c.type === 'reset_piece').length).toBe(9); // every block and ball back
    expect(out.find((c) => c.type === 'message')).toEqual({ type: 'message', text: "Ben's turn" });
    expect(e.scoreboard()[1]).toBe('▶ Ben: 0');
    // Ben's turn starts from a full tower: the two already down are not counted again
    e.tick(0.1, obs([...blocks(0), ...balls]));
    e.tick(0.1, obs([...blocks(0), ...balls], { shots: ['ball:0', 'ball:1', 'ball:2'] }));
    for (let i = 0; i < 40 && !e.state.over; i++) e.tick(0.1, obs([...blocks(3), ...balls]));
    expect(e.state.scores).toEqual([2, 3]);
    expect(e.state.message).toBe('Ben wins with 3');
  });
});

describe('V5 vocabulary: tilt, zone values, paths, held tools', () => {
  it('tilt_exceeded fires once per piece; a zone value scores; paths and handHeld are checked', () => {
    const g = clone(templateById('tower-balance')!);
    g.rules = [
      { when: { type: 'tilt_exceeded', degrees: 30, role: g.roles.find((r) => !r.pinned)!.id }, do: [{ type: 'add_score', counter: 'tipped' }] },
      ...g.rules,
    ];
    expect(validateSpec(g)).toEqual([]);
    const role = g.roles.find((r) => !r.pinned)!.id;
    const e = new RuleEngine(g);
    const b = (tilt: number) => piece(`${role}:0`, [0, 0.02, 0], { tilt });
    e.tick(0.1, obs([b(0)]));
    e.tick(0.1, obs([b(45)]));
    e.tick(0.1, obs([b(60)]));
    expect(e.state.counters.tipped).toBe(1);

    const t = clone(templateById('target-throw')!);
    t.zones = t.zones.map((z, i) => ({ ...z, value: (i + 1) * 5 }));
    const scoring = t.rules.find((r) => r.when.type === 'enters_zone')!;
    scoring.do = scoring.do.map((a) => (a.type === 'add_score' ? { type: 'add_score' } : a));
    expect(validateSpec(t)).toEqual([]);
    const te = new RuleEngine(t);
    const z = t.zones.find((x) => x.id === (scoring.when as { zone: string }).zone)!;
    const ballRole = (scoring.when as { role?: string }).role ?? t.roles[0].id;
    te.tick(0.1, obs([piece(`${ballRole}:0`, [0.3, 0.02, 0.3])]));
    te.tick(0.1, obs([piece(`${ballRole}:0`, [z.center[0], z.center[1], z.center[2]])]));
    expect(te.state.scores[0]).toBe(z.value);

    const p = clone(templateById('marble-run')!);
    p.paths = [{ id: 'lane', points: [[0, 0, -0.1], [0, 0, 0.1]] }];
    p.roles[0].handHeld = true;
    expect(validateSpec(p)).toEqual([]);
    p.paths = [{ id: 'far', points: [[0, 0, 0], [3, 0, 0]] }];
    expect(validateSpec(p).join()).toMatch(/off the table/);
  });
});
