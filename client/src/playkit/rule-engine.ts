/**
 * Deterministic interpreter for a Game Spec. Each tick it gets what the table
 * looks like (pieces in the play area's frame, contacts, shots) and returns
 * commands for the world (move a piece back, show a message). It keeps scores,
 * counters, turns and the timer. Pure: same spec + same observations = same
 * game, so it is unit-tested without any 3D.
 */
import type { Action, GameSpec, Rule, Trigger, Zone } from './game-spec.js';

export interface PieceObs {
  /** `role:index`, stable for the whole game. */
  key: string;
  role: string;
  /** Centre (play-area frame, m). */
  p: [number, number, number];
  /** Highest point above the table (m). */
  top: number;
  speed: number;
  held: boolean;
  /** Degrees between the piece's up and its up at the start (for tilt_exceeded). */
  tilt?: number;
}

export interface Observation {
  pieces: PieceObs[];
  /** Pairs of piece keys that touched this tick. */
  contacts: [string, string][];
  /** Keys of pieces that were thrown / flicked this tick. */
  shots: string[];
}

export type Command =
  | { type: 'respawn'; key: string }
  | { type: 'reset_piece'; key: string }
  | { type: 'message'; text: string };

export interface EngineState {
  scores: number[];
  player: number;
  /** 1-based round. */
  turn: number;
  shotsThisTurn: number;
  counters: Record<string, number>;
  elapsed: number;
  over: boolean;
  /** 'win' | 'lose' | 'done' (turns or time ran out) */
  result: 'win' | 'lose' | 'done' | null;
  /** Player index with the best score when the game ends (null: a draw or a single player). */
  winner: number | null;
  message: string;
}

const MOVING = 0.08, RESTING = 0.02, REST_TIME = 0.4, SETTLE_TIME = 0.6, HIT_COOLDOWN = 0.5;

interface PieceMemo {
  startY: number;
  inZone: Set<string>;
  fell: Set<number>;
  moving: boolean;
  still: number;
}

export class RuleEngine {
  state: EngineState;
  private memo = new Map<string, PieceMemo>();
  private fired = new Set<number>();
  private lastHit = new Map<string, number>();
  private settled = 0;
  private started = false;
  /** Pieces sent back by a rule this tick: skipped until the next tick. */
  private gone = new Set<string>();

  constructor(readonly spec: GameSpec) {
    this.state = RuleEngine.fresh(spec);
  }

  static fresh(spec: GameSpec): EngineState {
    return {
      scores: new Array(spec.players).fill(0), player: 0, turn: 1, shotsThisTurn: 0, counters: {}, elapsed: 0,
      over: false, result: null, winner: null, message: '',
    };
  }

  reset(): void {
    this.state = RuleEngine.fresh(this.spec);
    this.memo.clear();
    this.fired.clear();
    this.lastHit.clear();
    this.settled = 0;
    this.started = false;
  }

  /** A piece was put back by the world (respawn / reset): forget its history. */
  forgetPiece(key: string): void {
    this.memo.delete(key);
  }

  /** Player names for the scoreboard and messages (a room's players); else "Player N". */
  names: string[] = [];

  private nameOf(i: number): string {
    return this.names[i] || `Player ${i + 1}`;
  }

  tick(dt: number, obs: Observation): Command[] {
    const out: Command[] = [];
    if (this.state.over) return out;
    const s = this.state;
    s.elapsed += dt;
    const first = !this.started;
    this.started = true;
    this.gone.clear();

    // per-piece bookkeeping
    const pieces = new Map(obs.pieces.map((p) => [p.key, p]));
    for (const p of obs.pieces) {
      let m = this.memo.get(p.key);
      if (!m) {
        m = { startY: p.p[1], inZone: new Set(this.zonesAt(p)), fell: new Set(), moving: false, still: 0 };
        this.memo.set(p.key, m);
      }
    }

    for (const key of obs.shots) {
      if (this.spec.shotsPerTurn > 0) s.shotsThisTurn++;
      const m = this.memo.get(key);
      if (m) m.moving = true;
    }

    const run = (i: number, rule: Rule, key: string | null, zoneValue?: number) => {
      for (const a of rule.do) if (this.act(a, key, out, zoneValue)) return;
    };

    this.spec.rules.forEach((rule, i) => {
      if (s.over) return;
      const t = rule.when;
      const fits = (p: PieceObs, role?: string) => !this.gone.has(p.key) && (role === undefined || p.role === role);
      switch (t.type) {
        case 'enters_zone':
        case 'leaves_zone': {
          const zone = this.spec.zones.find((z) => z.id === t.zone)!;
          for (const p of obs.pieces) {
            if (!fits(p, t.role)) continue;
            const m = this.memo.get(p.key)!;
            const inside = !p.held && inZone(zone, p.p);
            const was = m.inZone.has(zone.id);
            if (!first && !p.held && t.type === 'enters_zone' && inside && !was) run(i, rule, p.key, this.zoneValue(t.zone));
            if (!first && !p.held && t.type === 'leaves_zone' && !inside && was) run(i, rule, p.key, this.zoneValue(t.zone));
          }
          break;
        }
        case 'falls_below_height':
          for (const p of obs.pieces) {
            if (!fits(p, t.role) || p.held) continue;
            const m = this.memo.get(p.key)!;
            const limit = t.relative ? m.startY - t.height : t.height;
            if (p.p[1] < limit && !m.fell.has(i)) {
              m.fell.add(i);
              run(i, rule, p.key);
            }
          }
          break;
        case 'tilt_exceeded':
          for (const p of obs.pieces) {
            if (!fits(p, t.role) || p.held || p.tilt === undefined) continue;
            const m = this.memo.get(p.key)!;
            if (p.tilt > t.degrees && !m.fell.has(i)) {
              m.fell.add(i);
              run(i, rule, p.key);
            }
          }
          break;
        case 'comes_to_rest':
          for (const p of obs.pieces) {
            if (!fits(p, t.role)) continue;
            const m = this.memo.get(p.key)!;
            if (!p.held && m.moving && m.still >= REST_TIME) {
              m.moving = false;
              run(i, rule, p.key);
            }
          }
          break;
        case 'hit_by':
          for (const [a, b] of obs.contacts) {
            for (const [x, y] of [[a, b], [b, a]] as const) {
              const px = pieces.get(x), py = pieces.get(y);
              if (!px || !py || px.role !== t.role || py.role !== t.by || this.gone.has(x)) continue;
              const k = `${i}|${x}|${y}`;
              if (s.elapsed - (this.lastHit.get(k) ?? -Infinity) < HIT_COOLDOWN) continue;
              this.lastHit.set(k, s.elapsed);
              run(i, rule, x);
            }
          }
          break;
        case 'stack_height_reached': {
          if (this.fired.has(i)) break;
          let top = 0;
          for (const p of obs.pieces) if (p.role === t.role && !p.held && p.speed < RESTING * 2) top = Math.max(top, p.top);
          if (top >= t.height) {
            this.fired.add(i);
            run(i, rule, null);
          }
          break;
        }
        case 'timer':
          if (!this.fired.has(i) && s.elapsed >= t.seconds) {
            this.fired.add(i);
            run(i, rule, null);
          }
          break;
        case 'count_reached':
          if (!this.fired.has(i) && (s.counters[t.counter] ?? 0) >= t.value) {
            this.fired.add(i);
            run(i, rule, null);
          }
          break;
      }
    });

    // zone membership and rest state after the rules saw the change
    let allStill = true;
    for (const p of obs.pieces) {
      const m = this.memo.get(p.key);
      if (!m || this.gone.has(p.key)) {
        this.memo.delete(p.key); // starts fresh where the world puts it
        continue;
      }
      if (p.held) {
        m.inZone.clear(); // carried pieces start over: lifting one out is not "leaving"
        m.still = 0;
        allStill = false;
        continue;
      }
      m.inZone = new Set(this.zonesAt(p));
      if (p.speed > MOVING) {
        m.moving = true;
        m.still = 0;
      } else if (p.speed < RESTING) m.still += dt;
      if (p.speed >= RESTING) allStill = false;
    }

    // turns: after the shots of a turn, wait until everything rests
    if (!s.over && this.spec.shotsPerTurn > 0 && s.shotsThisTurn >= this.spec.shotsPerTurn) {
      this.settled = allStill ? this.settled + dt : 0;
      if (this.settled >= SETTLE_TIME) this.endTurn(out);
    }
    if (!s.over && this.spec.timerSec > 0 && s.elapsed >= this.spec.timerSec) this.finish('done', out, "Time's up");
    return out;
  }

  /** Runs one action; true when the game ended (stop the rule). */
  private zoneValue(id: string): number | undefined {
    return this.spec.zones.find((z) => z.id === id)?.value;
  }

  private act(a: Action, key: string | null, out: Command[], zoneValue?: number): boolean {
    const s = this.state;
    switch (a.type) {
      case 'add_score':
        if (a.points ?? zoneValue) s.scores[s.player] += a.points ?? zoneValue ?? 0;
        if (a.counter) s.counters[a.counter] = (s.counters[a.counter] ?? 0) + 1;
        break;
      case 'end_turn':
        this.endTurn(out);
        break;
      case 'respawn':
      case 'reset_piece':
        if (key && !this.gone.has(key)) {
          out.push({ type: a.type, key });
          this.gone.add(key);
        }
        break;
      case 'show_message':
        s.message = a.text;
        out.push({ type: 'message', text: a.text });
        break;
      case 'win':
      case 'lose':
        this.finish(a.type, out);
        return true;
    }
    return s.over;
  }

  private endTurn(out: Command[]): void {
    const s = this.state;
    s.shotsThisTurn = 0;
    this.settled = 0;
    s.player = (s.player + 1) % this.spec.players;
    if (s.player === 0) s.turn++;
    if (this.spec.maxTurns > 0 && s.turn > this.spec.maxTurns) return this.finish('done', out, 'Last turn played');
    if (this.spec.resetEachTurn) {
      // the next player gets the same set-up: every piece back, the turn's counters cleared
      for (const key of this.memo.keys()) out.push({ type: 'reset_piece', key });
      this.memo.clear();
      s.counters = {};
    }
    if (this.spec.players > 1) out.push({ type: 'message', text: `${this.nameOf(s.player)}'s turn` });
  }

  private finish(result: 'win' | 'lose' | 'done', out: Command[], why?: string): void {
    const s = this.state;
    s.over = true;
    s.result = result;
    const best = Math.max(...s.scores);
    const leaders = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    s.winner = this.spec.players > 1 && leaders.length === 1 ? leaders[0] : null;
    const text = this.spec.players > 1
      ? (s.winner !== null ? `${this.nameOf(s.winner)} wins with ${best}` : `Draw at ${best}`)
      : result === 'win' ? (s.message || 'You win!') : result === 'lose' ? (s.message || 'Game over') : `${why ?? 'Done'}: ${s.scores[0]} points`;
    s.message = text;
    out.push({ type: 'message', text });
  }

  private zonesAt(p: PieceObs): string[] {
    return this.spec.zones.filter((z) => inZone(z, p.p)).map((z) => z.id);
  }

  /** Scoreboard lines for the HUD. */
  scoreboard(): string[] {
    const s = this.state, g = this.spec;
    const lines = g.players > 1 ? s.scores.map((v, i) => `${i === s.player && !s.over ? '▶ ' : ''}${this.nameOf(i)}: ${v}`) : [`Score: ${s.scores[0]}`];
    if (g.counter) lines.push(`${g.counter.label}: ${s.counters[g.counter.id] ?? 0}${g.counter.target ? ` / ${g.counter.target}` : ''}`);
    if (g.shotsPerTurn > 0 && !s.over) lines.push(`Shots: ${s.shotsThisTurn} / ${g.shotsPerTurn}` + (g.maxTurns > 0 ? ` · Turn ${s.turn} / ${g.maxTurns}` : ''));
    if (g.timerSec > 0 && !s.over) lines.push(`Time: ${Math.max(0, Math.ceil(g.timerSec - s.elapsed))} s`);
    return lines;
  }
}

export function inZone(z: Zone, p: [number, number, number]): boolean {
  const dx = p[0] - z.center[0], dy = p[1] - z.center[1], dz = p[2] - z.center[2];
  if (z.shape === 'box') return Math.abs(dx) <= z.size[0] / 2 && Math.abs(dy) <= z.size[1] / 2 && Math.abs(dz) <= z.size[2] / 2;
  return Math.hypot(dx, dz) <= z.size[0] && Math.abs(dy) <= z.size[1] / 2;
}

export type { Trigger };
