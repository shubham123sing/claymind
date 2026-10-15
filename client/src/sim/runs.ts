/**
 * The three headless jobs behind "Simulate it for me" (no AI needed, deterministic):
 * - runGame: the demo player plays a Game Spec on a simulated table with the real rule
 *   engine, until the game ends or 60 s of game time pass;
 * - stability ("Will it work?"): does everything stay where it is? If not, a fix is
 *   proposed only after the fixed version passes the same test;
 * - whatIf: 5-8 variants (material = mass, ramp angle) with one seed; the best is run
 *   again to prove the replay is identical.
 * All in the play area's frame (table top at y = 0).
 */
import { getMaterial } from '../materials/materials.js';
import type { GameSpec } from '../playkit/game-spec.js';
import { bottomOf, fallbackParts } from '../playkit/fallback-shapes.js';
import { RuleEngine, type Observation } from '../playkit/rule-engine.js';
import { HeadlessSim, speed, tiltDeg, type Q4, type SimPiece, type SimTable, type V3 } from './headless-sim.js';
import { Planner, type Action, type PieceView } from './planner.js';

export interface SimScene {
  table: SimTable;
  pieces: SimPiece[];
}

export interface GameRun {
  result: 'win' | 'lose' | 'done' | 'unfinished';
  scores: number[];
  counters: Record<string, number>;
  message: string;
  seconds: number;
  actions: number;
  /** positions at the end, rounded: equal hashes = identical runs */
  hash: string;
}

const HEADLESS_MAX_S = 60;

function roleOf(key: string): string {
  return key.includes(':') ? key.split(':')[0] : '';
}

function views(sim: HeadlessSim, scene: SimScene): PieceView[] {
  const out: PieceView[] = [];
  for (const p of scene.pieces) {
    const s = sim.get(p.key);
    if (!s) continue;
    out.push({ key: p.key, role: p.role ?? roleOf(p.key), p: s.p, halfH: sim.halfH.get(p.key) ?? 0.02, speed: speed(s.v), fixed: p.fixed, start: p.p });
  }
  return out;
}

function hashOf(sim: HeadlessSim): string {
  return sim.keys().sort().map((k) => (sim.get(k)?.p ?? [0, 0, 0]).map((x) => x.toFixed(4)).join(',')).join(';');
}

export async function runGame(scene: SimScene, spec: GameSpec, seed: number, maxSeconds = HEADLESS_MAX_S): Promise<GameRun> {
  const sim = await HeadlessSim.create(scene.table);
  try {
    for (const p of scene.pieces) sim.put(p);
    for (let i = 0; i < 36; i++) sim.step(); // settle 0.5 s
    sim.contacts.length = 0;
    const engine = new RuleEngine(spec);
    const planner = new Planner(spec, seed);
    let lastAction = -10, waitingForMore = true;
    const shots: string[] = [];
    while (sim.time < maxSeconds && !engine.state.over) {
      const v = views(sim, scene);
      const moving = v.some((p) => !p.fixed && p.speed > 0.05);
      const since = sim.time - lastAction;
      if (waitingForMore && since > 0.8 && (!moving || since > 3)) {
        const a = planner.next(v);
        if (a) {
          apply(sim, a, shots);
          lastAction = sim.time;
        } else waitingForMore = false;
      }
      // nothing left to do: let the rules finish the turn (they wait for everything to rest), at most 8 s
      if (!waitingForMore && since > 8) break;
      sim.step();
      const obs: Observation = {
        pieces: views(sim, scene).map((p) => ({ key: p.key, role: p.role, p: p.p, top: p.p[1] + p.halfH, speed: p.speed, held: false })),
        contacts: sim.contacts.splice(0),
        shots: shots.splice(0),
      };
      for (const c of engine.tick(sim.dt, obs)) {
        if (c.type === 'message') continue;
        const piece = sim.piece(c.key);
        if (!piece) continue;
        const role = spec.roles.find((r) => r.id === piece.role);
        const i = Number(c.key.split(':')[1]) || 0;
        const at: V3 = c.type === 'respawn' && role?.respawnAt
          ? [role.respawnAt[0] + (i % 3) * 0.035, role.respawnAt[1] + 0.02 - (sim.bottom.get(c.key) ?? 0), role.respawnAt[2] + Math.floor(i / 3) * 0.035]
          : piece.p;
        sim.put(piece, at, piece.q);
      }
    }
    const s = engine.state;
    return { result: s.result ?? 'unfinished', scores: [...s.scores], counters: { ...s.counters }, message: s.message, seconds: Math.round(sim.time * 10) / 10, actions: planner.actions, hash: hashOf(sim) };
  } finally {
    sim.destroy();
  }
}

function apply(sim: HeadlessSim, a: Action, shots: string[]): void {
  const piece = sim.piece(a.key);
  if (!piece) return;
  const q = sim.get(a.key)?.q ?? piece.q;
  if (a.kind === 'throw') {
    sim.put(piece, a.from, q, a.v, false);
    shots.push(a.key);
  } else if (a.kind === 'flick') {
    sim.setVelocity(a.key, a.v);
    shots.push(a.key);
  } else if (a.kind === 'drop') sim.put(piece, a.at, q, [0, -0.01, 0], false);
  else sim.put(piece, a.at, [0, 0, 0, 1] as Q4, [0, -0.01, 0], false);
}

/** A game's own layout with built-in shapes, on a 80 x 50 cm table (tests, and games not on the table yet). */
export function sceneFromSpec(spec: GameSpec, table: SimTable = { cx: 0, cz: 0, halfW: 0.4, halfD: 0.25, yaw: 0, floorY: -0.72 }): SimScene {
  const count = new Map<string, number>();
  const pieces: SimPiece[] = spec.layout.map((place) => {
    const role = spec.roles.find((r) => r.id === place.role)!;
    const i = count.get(role.id) ?? 0;
    count.set(role.id, i + 1);
    const parts = fallbackParts(role.fallback, role.material);
    const yaw = place.rotY ?? 0;
    return { key: `${role.id}:${i}`, role: role.id, parts, p: [place.at[0], place.at[1] - bottomOf(parts) + 0.001, place.at[2]], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], fixed: !!role.pinned };
  });
  return { table, pieces };
}

// ---------- Will it work? ----------

export interface Stability {
  ok: boolean;
  /** pieces that moved more than 1.5 cm, tipped over 15° or fell */
  moved: string[];
  sentences: string[];
}

export async function stability(scene: SimScene, seconds = 3): Promise<Stability> {
  const sim = await HeadlessSim.create(scene.table);
  try {
    for (const p of scene.pieces) sim.put(p);
    const steps = Math.round(seconds / sim.dt);
    for (let i = 0; i < steps; i++) sim.step();
    const moved: string[] = [];
    let fell = 0;
    for (const p of scene.pieces) {
      if (p.fixed) continue;
      const s = sim.get(p.key);
      if (!s) continue;
      const d = Math.hypot(s.p[0] - p.p[0], s.p[1] - p.p[1], s.p[2] - p.p[2]);
      const tipped = Math.abs(tiltDeg(s.q) - tiltDeg(p.q)) > 15;
      if (d > 0.015 || tipped) moved.push(p.key);
      if (s.p[1] < p.p[1] - 0.03) fell++;
    }
    const n = scene.pieces.filter((p) => !p.fixed).length;
    const sentences = moved.length === 0
      ? [`It works: all ${n} piece${n === 1 ? '' : 's'} stayed where they are for ${seconds} s.`]
      : [`It does not hold: ${moved.length} of ${n} piece${n === 1 ? '' : 's'} moved${fell ? `, ${fell} fell` : ''}.`];
    return { ok: moved.length === 0, moved, sentences };
  } finally {
    sim.destroy();
  }
}

export interface Fix {
  label: string;
  /** new poses (play-area frame) and / or materials by piece key */
  poses: Record<string, { p: V3; q: Q4 }>;
  materials: Record<string, string>;
}

/** A fix that is proven to work in simulation, or null. */
export async function suggestFix(scene: SimScene): Promise<Fix | null> {
  const loose = scene.pieces.filter((p) => !p.fixed);
  // 1. line stacked pieces up over the lowest one in their column
  const poses: Fix['poses'] = {};
  const columns: SimPiece[][] = [];
  for (const p of [...loose].sort((a, b) => a.p[1] - b.p[1])) {
    const col = columns.find((c) => Math.hypot(c[0].p[0] - p.p[0], c[0].p[2] - p.p[2]) < 0.05);
    if (col) col.push(p);
    else columns.push([p]);
  }
  for (const col of columns) {
    if (col.length < 2) continue;
    for (const p of col.slice(1)) poses[p.key] = { p: [col[0].p[0], p.p[1], col[0].p[2]], q: [0, 0, 0, 1] };
  }
  if (Object.keys(poses).length) {
    const fixed = { ...scene, pieces: scene.pieces.map((p) => (poses[p.key] ? { ...p, p: poses[p.key].p, q: poses[p.key].q } : p)) };
    if ((await stability(fixed)).ok) return { label: 'Line the pieces up over each other', poses, materials: {} };
  }
  // 2. a heavier bottom piece
  for (const m of ['stone', 'steel']) {
    const low = [...loose].sort((a, b) => a.p[1] - b.p[1])[0];
    if (!low) break;
    const heavy = { ...scene, pieces: scene.pieces.map((p) => (p.key === low.key ? { ...p, parts: p.parts.map((x) => ({ ...x, materialId: m })) } : p)) };
    if ((await stability(heavy)).ok) return { label: `Make the bottom piece ${getMaterial(m).name.toLowerCase()} (heavier)`, poses: {}, materials: { [low.key]: m } };
  }
  return null;
}

// ---------- What-if ----------

export interface WhatIfOption {
  id: string;
  label: string;
  role: string;
  kind: 'material' | 'tilt';
  values: (string | number)[];
}

export const MATERIAL_STEPS = ['foam', 'plastic', 'rubber', 'wood', 'stone', 'steel'];
export const TILT_STEPS = [8, 12, 16, 20, 24];

/** What can be varied in this game: a moving piece's material (its mass), a built-in ramp's angle. */
export function whatIfOptions(spec: GameSpec): WhatIfOption[] {
  const out: WhatIfOption[] = [];
  for (const r of spec.roles) {
    if (r.fallback === 'ramp') out.push({ id: `tilt:${r.id}`, label: 'Steeper or flatter ramp', role: r.id, kind: 'tilt', values: TILT_STEPS });
    else if (!r.pinned && (r.fallback === 'ball' || r.fallback === 'marble' || r.fallback === 'disc')) out.push({ id: `mat:${r.id}`, label: `Heavier or lighter ${r.label.toLowerCase()}`, role: r.id, kind: 'material', values: MATERIAL_STEPS });
    else if (!r.pinned && r.fallback === 'block') out.push({ id: `mat:${r.id}`, label: `Heavier or lighter ${r.label.toLowerCase()}`, role: r.id, kind: 'material', values: MATERIAL_STEPS });
  }
  // what is thrown, flicked or dropped first: that is what players change first
  const order = (o: WhatIfOption) => (o.kind === 'tilt' ? 1 : spec.roles.find((r) => r.id === o.role)?.fallback === 'block' ? 2 : 0);
  return out.sort((a, b) => order(a) - order(b)).slice(0, 3);
}

export interface Variant {
  label: string;
  value: string | number;
  run: GameRun;
}

function score(r: GameRun): number {
  const rank = { win: 3, done: 2, unfinished: 1, lose: 0 }[r.result];
  return rank * 1000 + Math.max(...r.scores) * 10 - r.seconds / 100;
}

export function variantScene(scene: SimScene, opt: WhatIfOption, value: string | number): SimScene {
  return {
    ...scene,
    pieces: scene.pieces.map((p) => {
      if (p.role !== opt.role) return p;
      if (opt.kind === 'material') return { ...p, parts: p.parts.map((x) => ({ ...x, materialId: String(value) })) };
      const parts = fallbackParts('ramp', p.parts[0].materialId, null, Number(value));
      // a different angle puts the lowest point elsewhere: keep it on the table
      const lift = bottomOf(p.parts) - bottomOf(parts);
      return { ...p, parts, p: [p.p[0], p.p[1] + lift, p.p[2]] as V3 };
    }),
  };
}

export async function whatIf(scene: SimScene, spec: GameSpec, opt: WhatIfOption, seed: number): Promise<{ variants: Variant[]; best: Variant; current: Variant | null; replayIdentical: boolean }> {
  const variants: Variant[] = [];
  for (const value of opt.values) {
    const run = await runGame(variantScene(scene, opt, value), spec, seed);
    variants.push({ label: opt.kind === 'tilt' ? `${value}°` : getMaterial(String(value)).name, value, run });
  }
  const now = scene.pieces.find((p) => p.role === opt.role);
  const currentValue = opt.kind === 'material' ? now?.parts[0].materialId : 16;
  const current = variants.find((v) => v.value === currentValue) ?? null;
  let best = variants.reduce((a, b) => (score(b.run) > score(a.run) ? b : a));
  // only a better result or score counts as better (not just a quicker game)
  if (current && Math.floor(score(best.run) / 10) <= Math.floor(score(current.run) / 10)) best = current;
  const again = await runGame(variantScene(scene, opt, best.value), spec, seed);
  return { variants, best, current, replayIdentical: again.hash === best.run.hash && again.result === best.run.result };
}
