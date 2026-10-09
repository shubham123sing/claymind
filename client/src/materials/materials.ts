/**
 * Material table (data in materials.json). Adding a material = adding one JSON
 * entry; nothing else changes. Also hosts the local material estimator:
 * template priors and/or shape-feature rules -> ranked material guesses.
 */
import data from './materials.json';
import type { ShapeDescriptor } from '../objects/descriptor.js';

export interface MaterialSound {
  /** Frequency ratios of the modal partials. */
  partials: number[];
  /** Base frequency (Hz). */
  base: number;
  /** Decay time constant (s). */
  decay: number;
  /** 0..1 noise burst mix (knock / crunch). */
  noise: number;
  gain: number;
}

export interface Material {
  id: string;
  name: string;
  /** kg/m^3 */
  density: number;
  friction: number;
  restitution: number;
  /** null = never breaks. breakSpeed = impact Δv (m/s) above which it shatters. */
  fragility: { breakSpeed: number; pieces: number } | null;
  hardness: number;
  sound: MaterialSound;
  visual: { color: string; roughness: number; metalness: number; opacity: number };
  tags: string[];
}

export type Priors = Record<string, number>;

interface ShapePriorRule {
  when: Partial<Record<keyof ShapeDescriptor, [number, number]>>;
  priors: Priors;
}

export const MATERIALS: Material[] = data.materials as unknown as Material[];
const byId = new Map(MATERIALS.map((m) => [m.id, m]));
const SHAPE_PRIORS = data.shapePriors as unknown as ShapePriorRule[];

export function getMaterial(id: string): Material {
  return byId.get(id) ?? byId.get('clay')!;
}

/** Priors from the first shape rule whose feature ranges all match. */
export function shapePriors(d: ShapeDescriptor): Priors {
  for (const rule of SHAPE_PRIORS) {
    const ok = Object.entries(rule.when).every(([k, range]) => {
      const v = d[k as keyof ShapeDescriptor] as number;
      return typeof v === 'number' && v >= range![0] && v <= range![1];
    });
    if (ok) return rule.priors;
  }
  return { clay: 1 };
}

export interface MaterialGuess {
  id: string;
  prob: number;
}

/**
 * Combine evidence (each a probability table with a weight) into a ranked list.
 * Later phases add VLM output and user-correction counts as further sources.
 */
export function estimateMaterial(sources: { priors: Priors; weight: number }[]): MaterialGuess[] {
  const acc = new Map<string, number>();
  let total = 0;
  for (const s of sources) {
    for (const [id, p] of Object.entries(s.priors)) {
      if (!byId.has(id)) continue;
      acc.set(id, (acc.get(id) ?? 0) + p * s.weight);
      total += p * s.weight;
    }
  }
  if (total === 0) return [{ id: 'clay', prob: 1 }];
  return [...acc.entries()].map(([id, v]) => ({ id, prob: v / total })).sort((a, b) => b.prob - a.prob);
}
