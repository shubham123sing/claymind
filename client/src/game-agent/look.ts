/**
 * "Make it a game" from one creation (V6, 4.1 and 4.2): the agent looks at what was made (its
 * measured size, fill, mass and pieces: the same stats the Play Kit keeps), says what it sees,
 * picks the one game that suits that shape and says why, as a checked Game Spec in which the
 * creation plays the main role. All code, instant and offline (the take-it-away test); the
 * Referee's physics dry run follows in the game agent before it is offered.
 * `explain` turns any Game Spec into plain sentences (explain mode).
 */
import { getMaterial } from '../materials/materials.js';
import { shapeFits, type KitStats } from '../playkit/kit-store.js';
import { SPEC_VERSION, type GameSpec, type Placement, type Rule, type Trigger, type Vec3 } from '../playkit/game-spec.js';

export interface LookPart {
  materialId: string;
  massKg: number;
}

export interface Look {
  /** What the agent recognised, one short line each. */
  seen: string[];
  /** The game's rule in one line, and why it suits this creation. */
  rule: string;
  why: string;
  /** The game; `role` is the role the creation plays in it. */
  spec: GameSpec;
  role: string;
}

const cm = (m: number) => `${Math.round(m)} cm`;
const grams = (kg: number) => (kg >= 1 ? `${(kg).toFixed(1)} kg` : `${Math.max(1, Math.round(kg * 1000))} g`);
const short = (name: string) => name.slice(0, 24);

const row = (role: string, n: number, z: number, gap: number): Placement[] =>
  Array.from({ length: n }, (_, i) => ({ role, at: [(i - (n - 1) / 2) * gap, 0, z] as Vec3 }));

/** Look at a creation and make the game that suits it. */
export function lookAt(name: string, st: KitStats, parts: LookPart[]): Look {
  const n = short(name);
  const [x, y, z] = st.sizeCm, big = Math.max(x, y, z);
  const seen = [`${n}: ${cm(x)} wide, ${cm(y)} tall, ${cm(z)} deep, ${grams(st.massKg)}`];
  const byMat = new Map<string, number>();
  for (const p of parts) byMat.set(p.materialId, (byMat.get(p.materialId) ?? 0) + 1);
  seen.push(parts.length > 1
    ? `${parts.length} pieces: ${[...byMat].map(([m, k]) => `${k} ${getMaterial(m).name.toLowerCase()}`).join(', ')}`
    : `One piece of ${getMaterial(parts[0]?.materialId ?? st.materials[0] ?? 'clay').name.toLowerCase()}`);
  const d = [...st.sizeCm].sort((a, b) => a - b), even = d[0] / Math.max(d[2], 0.1);
  const pct = Math.round(st.fill * 100);

  if (shapeFits(st, 'ball') && big <= 9) {
    seen.push(`Round: about the same size every way (${Math.round(even * 100)}%)`);
    return { seen, ...rollGame(n, big), why: `It is small and round, so it rolls: it can be the ball.` };
  }
  if (st.fill < 0.45 && y >= 4 && Math.min(x, z) >= 4) {
    seen.push(`Hollow: it fills only ${pct}% of its size`);
    return { seen, ...cupGame(n, st), why: `It is open and hollow, so a ball can land inside: it can be the cup.` };
  }
  seen.push(y >= Math.max(x, z) * 0.8 ? `It stands up tall on its own` : `It sits on the table on its own`);
  return { seen, ...toppleGame(n), why: `It stands on its own and is ${cm(big)} big: a good thing to aim at and knock over.` };
}

/** Your creation is the ball: three copies of it, thrown at a tower of six blocks. */
function rollGame(n: string, big: number): Pick<Look, 'rule' | 'spec' | 'role'> {
  const zt = -0.18, w = 0.045;
  const tower: Placement[] = [...row('block', 3, zt, w), ...row('block', 2, zt, w).map((p) => ({ ...p, at: [p.at[0], 0.04, zt] as Vec3 })), { role: 'block', at: [0, 0.08, zt] }];
  return {
    role: 'ball',
    rule: `Throw your ${n} at the tower: every block that falls scores.`,
    spec: {
      specVersion: SPEC_VERSION, id: 'your-ball', name: `${n} bowling`.slice(0, 40),
      summary: `Your ${n} is the ball: knock the block tower down.`,
      howToPlay: [`Pinch your ${n} and throw it at the tower.`, 'Each block that falls scores 1.', 'You have 3 throws.', 'Knock all 6 down to win.'],
      roles: [
        { id: 'block', label: 'Blocks', count: 6, tags: ['obstacle', 'target', 'piece'], fallback: 'block', material: 'wood' },
        { id: 'ball', label: n, count: 3, tags: ['piece', 'launcher'], fallback: 'ball', material: 'rubber' },
      ],
      layout: [...tower, ...row('ball', 3, 0.14, Math.max(0.06, big / 100 + 0.015))],
      zones: [],
      players: 1, shotsPerTurn: 3, maxTurns: 1, timerSec: 0, allowedActions: ['throw', 'flick'],
      rules: [
        { when: { type: 'falls_below_height', role: 'block', height: 0.02, relative: true }, do: [{ type: 'add_score', points: 1, counter: 'down' }] },
        { when: { type: 'count_reached', counter: 'down', value: 6 }, do: [{ type: 'show_message', text: 'All down!' }, { type: 'win' }] },
      ],
      counter: { id: 'down', label: 'Blocks down', target: 6 },
    },
  };
}

/** Your creation is the cup: throw balls into it, 3 in wins. */
function cupGame(n: string, st: KitStats): Pick<Look, 'rule' | 'spec' | 'role'> {
  const at: Vec3 = [0, 0, -0.12];
  const r = Math.max(0.015, (Math.min(st.sizeCm[0], st.sizeCm[2]) / 200) * 0.8), h = Math.max(0.03, st.sizeCm[1] / 100);
  return {
    role: 'cup',
    rule: `Throw balls into your ${n}: 3 in wins.`,
    spec: {
      specVersion: SPEC_VERSION, id: 'your-cup', name: `${n} toss`.slice(0, 40),
      summary: `Your ${n} is the cup: land the balls inside.`,
      howToPlay: [`Pinch a ball and throw it into your ${n}.`, 'Each ball that lands inside scores 1.', 'You have 5 throws.', 'Get 3 in to win.'],
      roles: [
        { id: 'cup', label: n, count: 1, tags: ['container', 'target'], fallback: 'cup', material: 'wood', pinned: true },
        { id: 'ball', label: 'Balls', count: 5, tags: ['piece'], fallback: 'ball', material: 'rubber' },
      ],
      layout: [{ role: 'cup', at }, ...row('ball', 5, 0.14, 0.05)],
      zones: [{ id: 'inside', shape: 'cylinder', center: [at[0], h / 2, at[2]], size: [r, h, 0] }],
      players: 1, shotsPerTurn: 5, maxTurns: 1, timerSec: 0, allowedActions: ['throw', 'drop'],
      rules: [
        { when: { type: 'enters_zone', zone: 'inside', role: 'ball' }, do: [{ type: 'add_score', points: 1, counter: 'in' }, { type: 'show_message', text: 'In!' }] },
        { when: { type: 'count_reached', counter: 'in', value: 3 }, do: [{ type: 'show_message', text: 'Three in: you win!' }, { type: 'win' }] },
      ],
      counter: { id: 'in', label: 'Balls in', target: 3 },
    },
  };
}

/** Your creation is the target: knock it over with three balls. */
function toppleGame(n: string): Pick<Look, 'rule' | 'spec' | 'role'> {
  return {
    role: 'target',
    rule: `Hit your ${n} with a ball (1 point), knock it over to win: 3 throws.`,
    spec: {
      specVersion: SPEC_VERSION, id: 'your-target', name: `Topple the ${n}`.slice(0, 40),
      summary: `Your ${n} is the target: knock it over.`,
      howToPlay: ['Pinch a ball and throw it.', `A hit on your ${n} scores 1.`, `Knock it over to win.`, 'You have 3 throws.'],
      roles: [
        { id: 'target', label: n, count: 1, tags: ['obstacle', 'target', 'piece'], fallback: 'block', material: 'wood' },
        { id: 'ball', label: 'Balls', count: 3, tags: ['piece', 'launcher'], fallback: 'ball', material: 'steel' },
      ],
      layout: [{ role: 'target', at: [0, 0, -0.15] }, ...row('ball', 3, 0.14, 0.06)],
      zones: [],
      players: 1, shotsPerTurn: 3, maxTurns: 1, timerSec: 0, allowedActions: ['throw', 'flick'],
      rules: [
        // a hit is felt at once (a heavy creation may not fall to a light ball); over is the win
        { when: { type: 'hit_by', role: 'target', by: 'ball' }, do: [{ type: 'add_score', points: 1 }, { type: 'show_message', text: 'Hit!' }] },
        { when: { type: 'tilt_exceeded', role: 'target', degrees: 45 }, do: [{ type: 'add_score', points: 3, counter: 'over' }] },
        { when: { type: 'count_reached', counter: 'over', value: 1 }, do: [{ type: 'show_message', text: 'Knocked over: you win!' }, { type: 'win' }] },
      ],
      counter: { id: 'over', label: 'Knocked over', target: 1 },
    },
  };
}

// ---------- explain mode ----------

function when(t: Trigger, g: GameSpec): string {
  const label = (id?: string) => {
    const r = id ? g.roles.find((x) => x.id === id) : undefined;
    return !r ? 'a piece' : r.count > 1 ? `one of the ${r.label.toLowerCase()}` : `the ${r.label}`;
  };
  const zone = (id: string) => (g.zones.length > 1 ? `zone "${id}"` : 'the zone');
  switch (t.type) {
    case 'enters_zone': return `When ${label(t.role)} lands in ${zone(t.zone)}`;
    case 'leaves_zone': return `When ${label(t.role)} leaves ${zone(t.zone)}`;
    case 'falls_below_height': return t.relative ? `When ${label(t.role)} falls ${Math.round(t.height * 100)} cm or more` : `When ${label(t.role)} drops below ${Math.round(t.height * 100)} cm`;
    case 'tilt_exceeded': return `When ${label(t.role)} tips over (more than ${t.degrees}°)`;
    case 'comes_to_rest': return `When ${label(t.role)} stops moving`;
    case 'hit_by': return `When ${label(t.by)} hits ${label(t.role)}`;
    case 'stack_height_reached': return `When the stack of ${(g.roles.find((r) => r.id === t.role)?.label ?? t.role).toLowerCase()} is ${Math.round(t.height * 100)} cm high`;
    case 'timer': return `After ${t.seconds} seconds`;
    case 'count_reached': return `When ${(g.counter?.id === t.counter ? g.counter.label : t.counter).toLowerCase()} reaches ${t.value}`;
  }
}

function does(r: Rule): string {
  const out: string[] = [];
  for (const a of r.do) {
    if (a.type === 'add_score') out.push(a.points === undefined ? 'you score the zone\'s points' : `you score ${a.points}`);
    else if (a.type === 'end_turn') out.push('the turn ends');
    else if (a.type === 'respawn' || a.type === 'reset_piece') out.push('it goes back to its start');
    else if (a.type === 'win') out.push('you win');
    else if (a.type === 'lose') out.push('you lose');
  }
  return out.join(' and ') || `it says "${(r.do.find((a) => a.type === 'show_message') as { text?: string } | undefined)?.text ?? ''}"`;
}

/** The game in plain sentences: what is on the table, each rule, the turns, how it ends. */
export function explain(g: GameSpec, uses: string[] = []): string[] {
  const lines = [uses.length ? `On the table: ${uses.join('; ')}.` : `On the table: ${g.roles.map((r) => `${r.count} × ${r.label.toLowerCase()}`).join(', ')}.`];
  for (const r of g.rules.slice(0, 5)) lines.push(`${when(r.when, g)}, ${does(r)}.`);
  if (g.shotsPerTurn > 0) lines.push(`Each turn you have ${g.shotsPerTurn} ${g.shotsPerTurn > 1 ? 'throws' : 'throw'}${g.maxTurns > 0 ? `, ${g.maxTurns} ${g.maxTurns > 1 ? 'turns' : 'turn'} each` : ''}${g.players > 1 ? `, ${g.players} players take turns` : ''}.`);
  if (g.timerSec > 0) lines.push(`The game lasts ${g.timerSec} seconds.`);
  if (!g.rules.some((r) => r.do.some((a) => a.type === 'win'))) lines.push('When the throws run out, the most points wins.');
  return lines;
}
