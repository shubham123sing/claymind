/**
 * Game Spec: a small, versioned JSON description of a table game that the
 * deterministic rule engine runs. It only names things from fixed lists
 * (triggers, actions, hand actions, built-in shapes): no code is ever executed
 * from a spec. `validateSpec` checks a spec before it is used (templates,
 * imported files and, later, agent proposals all go through it).
 *
 * Coordinates are in the play area's frame: metres, origin at the centre of the
 * play area on the table top, +y up, +z toward the player, +x to their right.
 */

export const SPEC_VERSION = 1;

export const ROLE_TAGS = ['board', 'piece', 'launcher', 'target', 'obstacle', 'container', 'other'] as const;
export type RoleTag = (typeof ROLE_TAGS)[number];

export const TRIGGERS = [
  'enters_zone', 'leaves_zone', 'falls_below_height', 'comes_to_rest', 'hit_by', 'stack_height_reached', 'timer', 'count_reached',
] as const;
export const ACTIONS = ['add_score', 'end_turn', 'respawn', 'reset_piece', 'show_message', 'win', 'lose'] as const;
export const HAND_ACTIONS = ['flick', 'throw', 'push', 'drop', 'place'] as const;
export type HandAction = (typeof HAND_ACTIONS)[number];

/** Built-in shapes used when the kit has nothing that fits a role. */
export const FALLBACK_SHAPES = ['block', 'ball', 'marble', 'disc', 'coin', 'board', 'cup', 'ramp'] as const;
export type FallbackShape = (typeof FALLBACK_SHAPES)[number];

export type Vec3 = [number, number, number];

export interface RoleSpec {
  id: string;
  label: string;
  /** How many pieces play this role (1-12). */
  count: number;
  /** Kit role tags that fit (first = best). */
  tags: RoleTag[];
  fallback: FallbackShape;
  /** Material of the built-in shape (a ClayMind material id). */
  material: string;
  /** Fixed in place while playing (a board, a ramp, a cup). */
  pinned?: boolean;
  /** Where `respawn` puts a piece of this role (default: its start). */
  respawnAt?: Vec3;
}

export interface Placement {
  role: string;
  /** Where the bottom centre of the piece goes. */
  at: Vec3;
  rotY?: number;
}

export interface Zone {
  id: string;
  shape: 'box' | 'cylinder';
  center: Vec3;
  /** box: full size x, y, z · cylinder: [radius, height, 0] */
  size: Vec3;
}

export type Trigger =
  | { type: 'enters_zone'; zone: string; role?: string }
  | { type: 'leaves_zone'; zone: string; role?: string }
  /** Below `height` m above the table, or with `relative`, `height` m below where the piece started. */
  | { type: 'falls_below_height'; height: number; relative?: boolean; role?: string }
  | { type: 'comes_to_rest'; role?: string }
  | { type: 'hit_by'; role: string; by: string }
  | { type: 'stack_height_reached'; role: string; height: number }
  | { type: 'timer'; seconds: number }
  | { type: 'count_reached'; counter: string; value: number };

export type Action =
  /** Points to the current player and/or +1 on a named counter. */
  | { type: 'add_score'; points?: number; counter?: string }
  | { type: 'end_turn' }
  /** The piece that triggered the rule goes to its role's respawn point. */
  | { type: 'respawn' }
  /** The piece that triggered the rule goes back to its start. */
  | { type: 'reset_piece' }
  | { type: 'show_message'; text: string }
  | { type: 'win' }
  | { type: 'lose' };

export interface Rule {
  when: Trigger;
  do: Action[];
}

export interface GameSpec {
  specVersion: number;
  id: string;
  name: string;
  /** One line under the name. */
  summary: string;
  /** How to play, 1-6 short lines. */
  howToPlay: string[];
  roles: RoleSpec[];
  layout: Placement[];
  zones: Zone[];
  players: number;
  /** Shots (throws / flicks) per turn; 0 = no turns. */
  shotsPerTurn: number;
  /** Turns per player; 0 = until a rule ends the game. */
  maxTurns: number;
  /** Game length limit in seconds; 0 = none. */
  timerSec: number;
  /** Every piece back to its start (and the turn's counters cleared) when a turn ends: each player plays the same set-up (Knock-down for 2-4). */
  resetEachTurn?: boolean;
  allowedActions: HandAction[];
  rules: Rule[];
  /** Counter shown on the scoreboard next to the scores (optional). */
  counter?: { id: string; label: string; target?: number };
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isVec = (x: unknown): x is Vec3 => Array.isArray(x) && x.length === 3 && x.every(isNum);
const isText = (x: unknown, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
/** The play area is a table: nothing further than this from its centre (m). */
const REACH = 0.8;

/** Every problem with a spec, in plain words (empty = valid). */
export function validateSpec(s: unknown): string[] {
  const e: string[] = [];
  const g = s as GameSpec;
  if (!g || typeof g !== 'object') return ['not a game spec'];
  if (g.specVersion !== SPEC_VERSION) e.push(`specVersion must be ${SPEC_VERSION}`);
  if (!isText(g.id, 40)) e.push('id missing');
  if (!isText(g.name, 40)) e.push('name missing');
  if (typeof g.summary !== 'string' || g.summary.length > 120) e.push('summary too long');
  if (!Array.isArray(g.howToPlay) || g.howToPlay.length < 1 || g.howToPlay.length > 6 || !g.howToPlay.every((l) => isText(l, 90))) e.push('howToPlay needs 1-6 short lines');
  if (!Number.isInteger(g.players) || g.players < 1 || g.players > 4) e.push('players must be 1-4');
  if (!Number.isInteger(g.shotsPerTurn) || g.shotsPerTurn < 0 || g.shotsPerTurn > 20) e.push('shotsPerTurn must be 0-20');
  if (!Number.isInteger(g.maxTurns) || g.maxTurns < 0 || g.maxTurns > 30) e.push('maxTurns must be 0-30');
  if (!isNum(g.timerSec) || g.timerSec < 0 || g.timerSec > 600) e.push('timerSec must be 0-600');
  if (g.resetEachTurn !== undefined && typeof g.resetEachTurn !== 'boolean') e.push('resetEachTurn must be true or false');
  if (!Array.isArray(g.allowedActions) || !g.allowedActions.every((a) => (HAND_ACTIONS as readonly string[]).includes(a))) e.push('unknown hand action');

  const roles = new Map<string, RoleSpec>();
  if (!Array.isArray(g.roles) || g.roles.length < 1 || g.roles.length > 6) e.push('roles must be 1-6');
  else {
    let total = 0;
    for (const r of g.roles) {
      if (!isText(r?.id, 24) || roles.has(r.id)) { e.push('role id missing or repeated'); continue; }
      roles.set(r.id, r);
      if (!isText(r.label, 30)) e.push(`role ${r.id}: label missing`);
      if (!Number.isInteger(r.count) || r.count < 1 || r.count > 12) e.push(`role ${r.id}: count must be 1-12`);
      total += r.count || 0;
      if (!Array.isArray(r.tags) || !r.tags.every((t) => (ROLE_TAGS as readonly string[]).includes(t))) e.push(`role ${r.id}: unknown tag`);
      if (!(FALLBACK_SHAPES as readonly string[]).includes(r.fallback)) e.push(`role ${r.id}: unknown built-in shape`);
      if (typeof r.material !== 'string') e.push(`role ${r.id}: material missing`);
      if (r.respawnAt !== undefined && !isVec(r.respawnAt)) e.push(`role ${r.id}: bad respawn point`);
    }
    if (total > 30) e.push('at most 30 pieces');
  }

  const zones = new Set<string>();
  if (!Array.isArray(g.zones) || g.zones.length > 8) e.push('zones must be 0-8');
  else for (const z of g.zones) {
    if (!isText(z?.id, 24) || zones.has(z.id)) { e.push('zone id missing or repeated'); continue; }
    zones.add(z.id);
    if (z.shape !== 'box' && z.shape !== 'cylinder') e.push(`zone ${z.id}: shape must be box or cylinder`);
    if (!isVec(z.center) || Math.hypot(z.center[0], z.center[2]) > REACH) e.push(`zone ${z.id}: centre off the table`);
    if (!isVec(z.size) || z.size[0] <= 0 || z.size[1] <= 0) e.push(`zone ${z.id}: bad size`);
  }

  if (!Array.isArray(g.layout)) e.push('layout missing');
  else {
    const placed = new Map<string, number>();
    for (const p of g.layout) {
      if (!roles.has(p?.role)) { e.push(`layout: unknown role ${p?.role}`); continue; }
      if (!isVec(p.at) || Math.hypot(p.at[0], p.at[2]) > REACH || p.at[1] < 0 || p.at[1] > 0.5) e.push(`layout: ${p.role} placed off the table`);
      placed.set(p.role, (placed.get(p.role) ?? 0) + 1);
    }
    for (const r of roles.values()) if ((placed.get(r.id) ?? 0) !== r.count) e.push(`layout: ${r.id} needs exactly ${r.count} place(s)`);
  }

  const roleOk = (r: string | undefined) => r === undefined || roles.has(r);
  const counters = new Set<string>();
  if (!Array.isArray(g.rules) || g.rules.length < 1 || g.rules.length > 24) e.push('rules must be 1-24');
  else {
    for (const rule of g.rules) for (const a of rule?.do ?? []) if (a?.type === 'add_score' && a.counter) counters.add(a.counter);
    let ends = g.maxTurns > 0 || g.timerSec > 0;
    g.rules.forEach((rule, i) => {
      const t = rule?.when as Trigger;
      if (!t || !(TRIGGERS as readonly string[]).includes(t.type)) { e.push(`rule ${i + 1}: unknown trigger`); return; }
      if ('role' in t && !roleOk(t.role)) e.push(`rule ${i + 1}: unknown role ${t.role}`);
      if ((t.type === 'enters_zone' || t.type === 'leaves_zone') && !zones.has(t.zone)) e.push(`rule ${i + 1}: unknown zone ${t.zone}`);
      if (t.type === 'hit_by' && !roles.has(t.by)) e.push(`rule ${i + 1}: unknown role ${t.by}`);
      if ((t.type === 'falls_below_height' || t.type === 'stack_height_reached') && (!isNum(t.height) || t.height < 0 || t.height > 1)) e.push(`rule ${i + 1}: bad height`);
      if (t.type === 'timer' && (!isNum(t.seconds) || t.seconds <= 0 || t.seconds > 600)) e.push(`rule ${i + 1}: bad timer`);
      if (t.type === 'count_reached' && (!counters.has(t.counter) || !Number.isInteger(t.value) || t.value < 1)) e.push(`rule ${i + 1}: counter ${t.counter} is never counted`);
      if (!Array.isArray(rule.do) || rule.do.length < 1 || rule.do.length > 6) { e.push(`rule ${i + 1}: needs 1-6 actions`); return; }
      for (const a of rule.do) {
        if (!a || !(ACTIONS as readonly string[]).includes(a.type)) e.push(`rule ${i + 1}: unknown action`);
        else if (a.type === 'add_score' && ((a.points !== undefined && (!isNum(a.points) || Math.abs(a.points) > 100)) || (a.points === undefined && !a.counter))) e.push(`rule ${i + 1}: add_score needs points or a counter`);
        else if (a.type === 'show_message' && !isText(a.text, 60)) e.push(`rule ${i + 1}: message missing or too long`);
        else if ((a.type === 'respawn' || a.type === 'reset_piece') && (t.type === 'timer' || t.type === 'count_reached' || t.type === 'stack_height_reached')) e.push(`rule ${i + 1}: ${a.type} needs a piece trigger`);
        if (a?.type === 'win' || a?.type === 'lose') ends = true;
      }
    });
    if (!ends) e.push('the game can never end (add a win/lose rule, turns or a time limit)');
  }
  if (g.counter && (!isText(g.counter.id, 24) || !isText(g.counter.label, 30))) e.push('counter needs an id and a label');
  return e;
}
