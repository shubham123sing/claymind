/**
 * The demo player's brain (code, no AI): what a person would do next in a table game,
 * using only the Game Spec's hand actions and speeds a human hand reaches. The same
 * planner drives the visible demo (ghost hand) and the headless runs (Will it work?,
 * What-if), seeded so a run can be replayed exactly.
 */
import type { GameSpec, RoleSpec } from '../playkit/game-spec.js';
import type { V3 } from './headless-sim.js';

/** Human limits (m/s): a gentle toss to a firm throw, and a fingertip flick. */
export const HUMAN = { throwMax: 4, flickMin: 1.2, flickMax: 2.5 };

export type Action =
  | { kind: 'throw'; key: string; from: V3; v: V3 }
  | { kind: 'flick'; key: string; from: V3; v: V3 }
  | { kind: 'drop'; key: string; at: V3 }
  | { kind: 'place'; key: string; at: V3 };

export interface PieceView {
  key: string;
  role: string;
  p: V3;
  /** half height (m) */
  halfH: number;
  speed: number;
  fixed: boolean;
  start: V3;
}

/** Small deterministic random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G = 9.81;

/** Launch velocity from `from` to land on `to` after `t` s (ballistic). */
export function ballistic(from: V3, to: V3, t: number): V3 {
  return [(to[0] - from[0]) / t, (to[1] - from[1]) / t + 0.5 * G * t, (to[2] - from[2]) / t];
}

function jitter(v: V3, r: () => number, speedPct: number, yawDeg: number): V3 {
  const k = 1 + (r() * 2 - 1) * speedPct;
  const a = ((r() * 2 - 1) * yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [(v[0] * c + v[2] * s) * k, v[1] * k, (-v[0] * s + v[2] * c) * k];
}

function capLength(v: V3, max: number): V3 {
  const l = Math.hypot(...v);
  return l > max ? (v.map((x) => (x * max) / l) as V3) : v;
}

export class Planner {
  private used = new Set<string>();
  private r: () => number;
  actions = 0;

  constructor(readonly spec: GameSpec, seed: number) {
    this.r = rng(seed);
  }

  private role(fn: (r: RoleSpec) => boolean): RoleSpec | undefined {
    return this.spec.roles.find(fn);
  }

  /** The next move, or null when there is nothing sensible left to do. */
  next(pieces: PieceView[]): Action | null {
    if (this.actions >= 16) return null;
    const a = this.spec.allowedActions;
    const act = a.includes('flick') && this.role((r) => r.fallback === 'disc' || r.tags.includes('launcher')) && this.spec.zones.length
      ? this.flick(pieces)
      : a.includes('throw') ? this.throw(pieces)
        : a.includes('place') && this.spec.zones.some((z) => z.shape === 'box') && !this.role((r) => r.fallback === 'ramp') ? this.place(pieces)
          : a.includes('drop') ? this.drop(pieces) : null;
    if (act) {
      this.actions++;
      this.used.add(act.key);
    }
    return act;
  }

  /** Throw the next ball at what is still standing (or into the best cup). */
  private throw(pieces: PieceView[]): Action | null {
    const proj = this.role((r) => r.fallback === 'ball' || r.fallback === 'marble') ?? this.spec.roles.find((r) => !r.pinned);
    if (!proj) return null;
    const ball = pieces.filter((p) => p.role === proj.id && !p.fixed && !this.used.has(p.key)).sort((x, y) => y.p[2] - x.p[2])[0];
    if (!ball) return null;
    let target: V3 | null = null;
    // into a zone (cups): the higher the points the likelier
    const scored = this.spec.rules.flatMap((rule) => (rule.when.type === 'enters_zone' && (rule.when.role === undefined || rule.when.role === proj.id) ? [{ zone: rule.when.zone, pts: rule.do.find((x) => x.type === 'add_score')?.points ?? 1 }] : []));
    if (scored.length) {
      const total = scored.reduce((s, z) => s + Math.max(1, z.pts), 0);
      let pick = this.r() * total;
      const z = scored.find((s) => (pick -= Math.max(1, s.pts)) <= 0) ?? scored[0];
      const zone = this.spec.zones.find((x) => x.id === z.zone)!;
      target = [zone.center[0], zone.center[1] + zone.size[1] / 2 + 0.02, zone.center[2]];
    } else {
      // at the other loose pieces still standing near where they started
      const others = pieces.filter((p) => p.role !== proj.id && !p.fixed && p.p[1] > p.start[1] - 0.015);
      if (!others.length) return null;
      target = [0, 0, 0];
      for (const o of others) for (let k = 0; k < 3; k++) target[k] += o.p[k] / others.length;
    }
    const from: V3 = [ball.p[0], ball.p[1] + 0.12, ball.p[2]];
    const dist = Math.hypot(target[0] - from[0], target[2] - from[2]);
    const v = jitter(ballistic(from, target, Math.max(0.18, Math.min(0.5, dist / 1.6))), this.r, 0.05, 2);
    return { kind: 'throw', key: ball.key, from, v: capLength(v, HUMAN.throwMax) };
  }

  /** Flick the striker at the coin with the easiest straight path to a pocket. */
  private flick(pieces: PieceView[]): Action | null {
    const sRole = this.role((r) => r.fallback === 'disc' || r.tags.includes('launcher'))!;
    const striker = pieces.find((p) => p.role === sRole.id);
    if (!striker) return null;
    // coins still on the board (pocketed ones wait on the tray beside it)
    const board = pieces.find((p) => p.fixed && this.spec.roles.find((r) => r.id === p.role)?.fallback === 'board');
    const onBoard = (p: PieceView) => !board || (Math.abs(p.p[0] - board.p[0]) < 0.165 && Math.abs(p.p[2] - board.p[2]) < 0.165 && p.p[1] > board.p[1]);
    const coins = pieces.filter((p) => p.role !== sRole.id && !p.fixed && onBoard(p));
    const pockets = this.spec.zones;
    let best: { coin: PieceView; aim: V3; cut: number } | null = null;
    for (const c of coins) {
      for (const z of pockets) {
        const d: V3 = [z.center[0] - c.p[0], 0, z.center[2] - c.p[2]];
        const dl = Math.hypot(d[0], d[2]) || 1;
        const aim: V3 = [c.p[0] - (d[0] / dl) * 0.03, striker.p[1], c.p[2] - (d[2] / dl) * 0.03]; // ghost-ball point
        const s: V3 = [aim[0] - striker.p[0], 0, aim[2] - striker.p[2]];
        const sl = Math.hypot(s[0], s[2]) || 1;
        const cut = 1 - (s[0] * d[0] + s[2] * d[2]) / (sl * dl); // 0 = straight line
        if (!best || cut < best.cut) best = { coin: c, aim, cut };
      }
    }
    if (!best) return null;
    const dir: V3 = [best.aim[0] - striker.p[0], 0, best.aim[2] - striker.p[2]];
    const l = Math.hypot(dir[0], dir[2]) || 1;
    const sp = HUMAN.flickMin + this.r() * (HUMAN.flickMax - HUMAN.flickMin);
    const v = jitter([(dir[0] / l) * sp, 0, (dir[2] / l) * sp], this.r, 0.03, 1.5);
    this.used.delete(striker.key); // the striker is flicked again every turn
    return { kind: 'flick', key: striker.key, from: striker.p, v };
  }

  /** Drop the next marble at the top of the ramp. */
  private drop(pieces: PieceView[]): Action | null {
    const ramp = pieces.find((p) => p.fixed && this.spec.roles.find((r) => r.id === p.role)?.fallback === 'ramp');
    const mRole = this.role((r) => !r.pinned);
    const marble = pieces.filter((p) => p.role === mRole?.id && !this.used.has(p.key)).sort((x, y) => x.p[0] - y.p[0])[0];
    if (!ramp || !marble) return null;
    // the high end of the built-in ramp is 15 cm behind its centre (toward -z), about 9 cm up
    const at: V3 = [ramp.p[0] + (this.r() * 2 - 1) * 0.01, ramp.p[1] + ramp.halfH + 0.03, ramp.p[2] - 0.13];
    return { kind: 'drop', key: marble.key, at };
  }

  /** Place the next block on top of the stack in the tower zone, a few mm off centre. */
  private place(pieces: PieceView[]): Action | null {
    const zone = this.spec.zones.find((z) => z.shape === 'box')!;
    const inZone = (p: PieceView) => Math.abs(p.p[0] - zone.center[0]) < zone.size[0] / 2 && Math.abs(p.p[2] - zone.center[2]) < zone.size[2] / 2;
    const block = pieces.filter((p) => !p.fixed && !inZone(p) && !this.used.has(p.key)).sort((x, y) => x.p[0] - y.p[0])[0];
    if (!block) return null;
    let top = 0;
    for (const p of pieces) if (inZone(p)) top = Math.max(top, p.p[1] + p.halfH);
    const off = () => (this.r() * 2 - 1) * 0.003;
    return { kind: 'place', key: block.key, at: [zone.center[0] + off(), top + block.halfH + 0.002, zone.center[2] + off()] };
  }
}
