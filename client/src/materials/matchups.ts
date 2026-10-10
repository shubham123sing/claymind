/**
 * Material pair rules (data in matchups.json): how much an impact hurts each
 * side, friction between them, and how much of the other material's sound
 * joins the hit. Order matters for damage: matchup('glass', 'steel').damage is
 * what happens to the glass.
 */
import data from './matchups.json';
import { normalizeMaterialId } from './materials.js';

export interface Matchup {
  /** Multiplies the impact speed felt by the first material (> 1 = breaks sooner). */
  damage: number;
  /** Multiplies friction for the pair. */
  friction: number;
  /** 0..1: how loud the second material's sound is mixed into the hit. */
  otherSound: number;
}

interface Pair {
  a: string;
  b: string;
  damageToA?: number;
  damageToB?: number;
  friction?: number;
  otherSound?: number;
}

const D = data.defaults;
const table = new Map<string, Matchup>();
for (const p of data.pairs as Pair[]) {
  table.set(`${p.a}|${p.b}`, { damage: p.damageToA ?? D.damageToA, friction: p.friction ?? D.friction, otherSound: p.otherSound ?? D.otherSound });
  if (!table.has(`${p.b}|${p.a}`) || p.a === p.b)
    table.set(`${p.b}|${p.a}`, { damage: p.damageToB ?? D.damageToB, friction: p.friction ?? D.friction, otherSound: p.otherSound ?? D.otherSound });
}
const DEFAULT: Matchup = { damage: D.damageToA, friction: D.friction, otherSound: D.otherSound };

export function matchup(self: string, other: string): Matchup {
  return table.get(`${normalizeMaterialId(self)}|${normalizeMaterialId(other)}`) ?? DEFAULT;
}

/**
 * Speed (m/s) a part "feels" in a hit, to compare with its material's breakSpeed.
 * Own hit: its own velocity change. Hit by another object: the impactor's
 * impulse divided by this object's mass (what it would feel if free; an object
 * pinned against the table cannot move, yet is crushed). Both scaled by the pair rule.
 */
export function feltSpeed(self: string, other: string, ownDv: number, impact?: { impulse: number; selfMassKg: number }): number {
  const dv = impact ? Math.max(ownDv, impact.impulse / Math.max(impact.selfMassKg, 1e-3)) : ownDv;
  return dv * matchup(self, other).damage;
}

/** Material of a built-in surface the object can land on. */
export const SURFACE_MATERIAL: Record<'table' | 'floor', string> = data.surfaces as Record<'table' | 'floor', string>;
