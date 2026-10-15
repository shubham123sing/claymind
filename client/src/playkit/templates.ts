/**
 * The five built-in games (Game Specs). Layouts stay within ±22 cm front to back
 * and ±30 cm side to side, so they fit a small (50 cm deep) table.
 * Each works with built-in shapes alone,
 * and any role can be played by the player's own kit items instead.
 * Frame: metres, origin at the play area's centre on the table, +z toward the
 * player, +x to their right; `at` is where a piece's bottom centre goes.
 */
import { GameSpec, Placement, Rule, SPEC_VERSION, Vec3 } from './game-spec.js';

const row = (role: string, n: number, z: number, gap: number, y = 0): Placement[] =>
  Array.from({ length: n }, (_, i) => ({ role, at: [(i - (n - 1) / 2) * gap, y, z] as Vec3 }));

function knockDown(): GameSpec {
  const z = -0.18, w = 0.045;
  const tower: Placement[] = [...row('block', 3, z, w), ...row('block', 2, z, w, 0.04), ...row('block', 1, z, w, 0.08)];
  return {
    specVersion: SPEC_VERSION, id: 'knock-down', name: 'Knock-down',
    summary: 'Throw balls at the block tower. Every block that falls scores.',
    howToPlay: ['Pinch a ball and throw it at the tower.', 'Each block that falls scores 1.', 'You have 3 balls.', 'Knock all 6 down to win.'],
    roles: [
      { id: 'block', label: 'Blocks', count: 6, tags: ['obstacle', 'target', 'piece'], fallback: 'block', material: 'wood' },
      { id: 'ball', label: 'Balls', count: 3, tags: ['piece', 'launcher'], fallback: 'ball', material: 'steel' },
    ],
    layout: [...tower, ...row('ball', 3, 0.14, 0.06)],
    zones: [],
    players: 1, shotsPerTurn: 3, maxTurns: 1, timerSec: 0, allowedActions: ['throw', 'flick'],
    rules: [
      { when: { type: 'falls_below_height', role: 'block', height: 0.02, relative: true }, do: [{ type: 'add_score', points: 1, counter: 'down' }] },
      { when: { type: 'count_reached', counter: 'down', value: 6 }, do: [{ type: 'show_message', text: 'All down!' }, { type: 'win' }] },
    ],
    counter: { id: 'down', label: 'Blocks down', target: 6 },
  };
}

function flickAndPocket(): GameSpec {
  const bz = -0.04, inner = 0.14;
  const pockets = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => ({
    id: `pocket${i + 1}`, shape: 'cylinder' as const, center: [sx * inner, 0.02, bz + sz * inner] as Vec3, size: [0.028, 0.05, 0] as Vec3,
  }));
  const coins: Placement[] = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return { role: 'coin', at: [Math.cos(a) * 0.04, 0.012, bz + Math.sin(a) * 0.04] };
  });
  const rules: Rule[] = [];
  for (const p of pockets) {
    rules.push({ when: { type: 'enters_zone', zone: p.id, role: 'coin' }, do: [{ type: 'add_score', points: 1, counter: 'pocketed' }, { type: 'respawn' }] });
    rules.push({ when: { type: 'enters_zone', zone: p.id, role: 'striker' }, do: [{ type: 'add_score', points: -1 }, { type: 'show_message', text: 'Striker in: -1' }, { type: 'respawn' }] });
  }
  rules.push({ when: { type: 'count_reached', counter: 'pocketed', value: 6 }, do: [{ type: 'show_message', text: 'Every coin is in!' }, { type: 'win' }] });
  return {
    specVersion: SPEC_VERSION, id: 'flick-and-pocket', name: 'Flick-and-pocket',
    summary: 'Flick the striker to push coins into the corner pockets.',
    howToPlay: ['Flick the striker with your fingertip.', 'A coin in a corner pocket: +1.', 'The striker in a pocket: -1.', 'Two players, one flick each turn.'],
    roles: [
      { id: 'board', label: 'Board', count: 1, tags: ['board'], fallback: 'board', material: 'plastic', pinned: true },
      { id: 'coin', label: 'Coins', count: 6, tags: ['piece'], fallback: 'coin', material: 'plastic', respawnAt: [0.25, 0, bz - 0.06] },
      { id: 'striker', label: 'Striker', count: 1, tags: ['launcher', 'piece'], fallback: 'disc', material: 'plastic' },
    ],
    layout: [{ role: 'board', at: [0, 0, bz] }, ...coins, { role: 'striker', at: [0, 0.012, bz + 0.12] }],
    zones: pockets,
    players: 2, shotsPerTurn: 1, maxTurns: 8, timerSec: 0, allowedActions: ['flick', 'push'],
    rules,
    counter: { id: 'pocketed', label: 'Coins in', target: 6 },
  };
}

function targetThrow(): GameSpec {
  const cups: [number, number, number][] = [[-0.13, -0.08, 1], [0, -0.19, 3], [0.13, -0.08, 1]];
  return {
    specVersion: SPEC_VERSION, id: 'target-throw', name: 'Target throw',
    summary: 'Throw balls into the cups. The far cup is worth more.',
    howToPlay: ['Pinch a ball and toss it into a cup.', 'Near cups: 1 point. Far cup: 3 points.', 'You have 5 balls.'],
    roles: [
      { id: 'cup', label: 'Cups', count: 3, tags: ['container', 'target'], fallback: 'cup', material: 'plastic', pinned: true },
      { id: 'ball', label: 'Balls', count: 5, tags: ['piece'], fallback: 'ball', material: 'rubber' },
    ],
    layout: [...cups.map(([x, z]) => ({ role: 'cup', at: [x, 0, z] as Vec3 })), ...row('ball', 5, 0.14, 0.05)],
    zones: cups.map(([x, z], i) => ({ id: `cup${i + 1}`, shape: 'cylinder' as const, center: [x, 0.03, z] as Vec3, size: [0.03, 0.06, 0] as Vec3 })),
    players: 1, shotsPerTurn: 5, maxTurns: 1, timerSec: 0, allowedActions: ['throw', 'drop'],
    rules: cups.map(([, , pts], i) => ({ when: { type: 'enters_zone', zone: `cup${i + 1}`, role: 'ball' }, do: [{ type: 'add_score', points: pts, counter: 'in' }] }) as Rule),
    counter: { id: 'in', label: 'Balls in' },
  };
}

function towerBalance(): GameSpec {
  return {
    specVersion: SPEC_VERSION, id: 'tower-balance', name: 'Tower balance',
    summary: 'Stack blocks on the square as high as you can without a fall.',
    howToPlay: ['Pinch a block and place it on the square.', 'Stack them up: 4 blocks high wins.', 'If a block falls off the square, the tower is lost.'],
    roles: [{ id: 'block', label: 'Blocks', count: 8, tags: ['piece', 'obstacle'], fallback: 'block', material: 'wood' }],
    layout: row('block', 8, 0.14, 0.045),
    zones: [{ id: 'tower', shape: 'box', center: [0, 0.15, -0.1], size: [0.14, 0.3, 0.14] }],
    players: 1, shotsPerTurn: 0, maxTurns: 0, timerSec: 0, allowedActions: ['place', 'drop'],
    rules: [
      { when: { type: 'enters_zone', zone: 'tower', role: 'block' }, do: [{ type: 'add_score', points: 1, counter: 'stacked' }] },
      { when: { type: 'stack_height_reached', role: 'block', height: 0.155 }, do: [{ type: 'show_message', text: 'Four high: you win!' }, { type: 'win' }] },
      { when: { type: 'leaves_zone', zone: 'tower', role: 'block' }, do: [{ type: 'show_message', text: 'A block fell: tower lost' }, { type: 'lose' }] },
    ],
    counter: { id: 'stacked', label: 'Blocks placed' },
  };
}

function marbleRun(): GameSpec {
  return {
    specVersion: SPEC_VERSION, id: 'marble-run', name: 'Marble run',
    summary: 'Drop marbles at the top of the ramp; get all 3 to the finish in time.',
    howToPlay: ['Pinch a marble and drop it at the top of the ramp.', 'It must roll into the finish zone.', 'Get all 3 home within 60 seconds.'],
    roles: [
      { id: 'ramp', label: 'Ramp', count: 1, tags: ['launcher', 'obstacle', 'board'], fallback: 'ramp', material: 'wood', pinned: true },
      { id: 'marble', label: 'Marbles', count: 3, tags: ['piece'], fallback: 'marble', material: 'steel' },
    ],
    layout: [{ role: 'ramp', at: [0, 0, -0.08] }, ...row('marble', 3, 0.14, 0.04).map((p) => ({ ...p, at: [p.at[0] + 0.2, 0, p.at[2]] as Vec3 }))],
    zones: [{ id: 'finish', shape: 'box', center: [0, 0.025, 0.12], size: [0.16, 0.05, 0.08] }],
    players: 1, shotsPerTurn: 0, maxTurns: 0, timerSec: 0, allowedActions: ['drop', 'place'],
    rules: [
      { when: { type: 'enters_zone', zone: 'finish', role: 'marble' }, do: [{ type: 'add_score', points: 1, counter: 'home' }, { type: 'show_message', text: 'Finish!' }] },
      { when: { type: 'count_reached', counter: 'home', value: 3 }, do: [{ type: 'show_message', text: 'All three home!' }, { type: 'win' }] },
      { when: { type: 'timer', seconds: 60 }, do: [{ type: 'show_message', text: 'Out of time' }, { type: 'lose' }] },
    ],
    counter: { id: 'home', label: 'Marbles home', target: 3 },
  };
}

export const TEMPLATES: GameSpec[] = [knockDown(), flickAndPocket(), targetThrow(), towerBalance(), marbleRun()];

export function templateById(id: string): GameSpec | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
