/**
 * The Referee's dry run (V5): a Game Spec played headless in the game's own physics (Havok,
 * the same bodies), by the demo planner with human-possible actions, deterministic.
 * Used in the client's dry-run worker before a new game is offered, and by the tests.
 * - runGame: the demo player plays a Game Spec on a simulated table with the real rule
 *   engine, until the game ends or 60 s of game time pass;
 * - stability ("Will it work?"): does everything stay where it is? If not, a fix is
 *   proposed only after the fixed version passes the same test;
 * - whatIf: 5-8 variants (material = mass, ramp angle) with one seed; the best is run
 *   again to prove the replay is identical.
 * All in the play area's frame (table top at y = 0).
 */
import type { GameSpec } from '../playkit/game-spec.js';
import { bottomOf, fallbackParts } from '../playkit/fallback-shapes.js';
import { RuleEngine, type Observation } from '../playkit/rule-engine.js';
import { HeadlessSim, speed, type Q4, type SimPiece, type SimTable, type V3 } from './headless-sim.js';
import { Planner, type Action, type PieceView } from '../playkit/demo-planner.js';

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

// ---------- the Referee's dry run ----------

export interface DryRun {
  ok: boolean;
  /** Plain problems for the Designer's repair (or the player). */
  problems: string[];
  run: GameRun | null;
}

/**
 * Does the game work in the real physics? The set-up must stand still on the table (nothing
 * falls off or topples by itself), and a test game by the demo planner must make progress
 * (score, count or end) within `seconds`.
 */
export async function dryRun(scene: SimScene, spec: GameSpec, seed = 7, seconds = 20): Promise<DryRun> {
  const problems: string[] = [];
  const sim = await HeadlessSim.create(scene.table);
  try {
    for (const p of scene.pieces) sim.put(p);
    for (let i = 0; i < 108; i++) sim.step(); // 1.5 s
    for (const p of scene.pieces) {
      if (p.fixed) continue;
      const s = sim.get(p.key);
      if (!s) continue;
      const label = spec.roles.find((r) => r.id === p.role)?.label ?? p.key;
      if (s.p[1] < -0.03) problems.push(`${label} falls off the table at the start`);
      else if (Math.hypot(s.p[0] - p.p[0], s.p[2] - p.p[2]) > 0.05) problems.push(`${label} does not stay where it is placed`);
    }
  } finally {
    sim.destroy();
  }
  let run: GameRun | null = null;
  try {
    run = await runGame(scene, spec, seed, seconds);
    const moved = run.result !== 'unfinished' || run.scores.some((v) => v !== 0) || Object.values(run.counters).some((v) => v > 0);
    if (run.actions === 0 && spec.allowedActions.length) problems.push('the test player found no move it could make with these pieces');
    else if (!moved) problems.push(`nothing scored or counted in a ${seconds} s test game`);
  } catch (e) {
    problems.push(`the test game stopped: ${String(e).slice(0, 80)}`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)].slice(0, 4), run };
}
