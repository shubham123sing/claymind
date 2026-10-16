/**
 * The rules card: the player's numbers applied to a game (players, turns, shots, win
 * target, time), then the Referee again before playing: `validateSpec` plus "can it be
 * won" (a win counter can never need more than there are pieces to count). Same rules as
 * the backend's apply_adapt / referee (server/agents/referee.py).
 */
import { validateSpec, type GameSpec } from '../playkit/game-spec.js';
import type { RuleNumbers } from './game-agent-panel.js';

export function numbersOf(g: GameSpec): RuleNumbers {
  const win = g.rules.find((r) => r.when.type === 'count_reached' && r.do.some((a) => a.type === 'win'));
  const timer = g.rules.find((r) => r.when.type === 'timer');
  return {
    players: g.players,
    maxTurns: g.maxTurns,
    shotsPerTurn: g.shotsPerTurn,
    target: win && win.when.type === 'count_reached' ? win.when.value : 0,
    timerSec: timer && timer.when.type === 'timer' ? timer.when.seconds : g.timerSec,
  };
}

/** Problems that make a valid spec unwinnable (empty = playable). */
export function playable(g: GameSpec): string[] {
  const e: string[] = [];
  const count = (role: string) => g.roles.find((r) => r.id === role)?.count ?? 0;
  for (const rule of g.rules) {
    const t = rule.when;
    if (t.type !== 'count_reached') continue;
    let best = 0;
    for (const r2 of g.rules) {
      if (!r2.do.some((a) => a.type === 'add_score' && a.counter === t.counter)) continue;
      const role = 'role' in r2.when ? r2.when.role : undefined;
      best = role === undefined || r2.do.some((a) => a.type === 'respawn' || a.type === 'reset_piece') ? Infinity : best + count(role);
    }
    if (best < t.value) e.push(`Win at ${t.value} is impossible: there are only ${best} to count`);
  }
  return e;
}

export function applyNumbers(base: GameSpec, n: RuleNumbers): { spec: GameSpec; problems: string[] } {
  const g: GameSpec = JSON.parse(JSON.stringify(base));
  g.players = n.players;
  g.maxTurns = n.maxTurns;
  g.shotsPerTurn = n.shotsPerTurn;
  const timers = g.rules.filter((r) => r.when.type === 'timer');
  if (timers.length && n.timerSec > 0) for (const r of timers) (r.when as { seconds: number }).seconds = n.timerSec;
  else if (timers.length) g.rules = g.rules.filter((r) => r.when.type !== 'timer'); // time limit off
  else g.timerSec = n.timerSec;
  for (const r of g.rules) {
    if (r.when.type === 'count_reached' && r.do.some((a) => a.type === 'win')) {
      if (n.target > 0) r.when.value = n.target;
      if (g.counter && g.counter.id === r.when.counter) g.counter.target = n.target > 0 ? n.target : r.when.value;
    }
  }
  if (n.target === 0) {
    // "most points wins": no win-at rule, the game needs turns or a time limit to end
    g.rules = g.rules.filter((r) => !(r.when.type === 'count_reached' && r.do.some((a) => a.type === 'win')));
    if (!g.rules.length) g.rules = base.rules;
  }
  g.id = `${base.id.replace(/-custom$/, '')}-custom`;
  return { spec: g, problems: [...validateSpec(g), ...playable(g)] };
}

/** The numbers as words, for the Designer ("2 players, 3 turns each, ..."). */
export function rulesInWords(n: RuleNumbers, extra: string): string {
  const parts = [
    n.players > 1 ? `${n.players} players` : '1 player',
    n.shotsPerTurn > 0 ? `${n.shotsPerTurn} shot${n.shotsPerTurn > 1 ? 's' : ''} per turn` : 'no turns',
    n.maxTurns > 0 ? `${n.maxTurns} turn${n.maxTurns > 1 ? 's' : ''} each` : '',
    n.target > 0 ? `first to ${n.target} wins` : 'most points wins',
    n.timerSec > 0 ? `${n.timerSec} second time limit` : '',
    extra.trim(),
  ];
  return parts.filter(Boolean).join(', ');
}
