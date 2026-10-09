/**
 * Local shape matcher: weighted distance between shape descriptors.
 * Works offline, no AI. Candidates are templates (and, later, the user's own
 * library, which is what makes repeat creations instant).
 */
import type { ShapeDescriptor } from './descriptor.js';

export interface MatchCandidate {
  id: string;
  descriptor: ShapeDescriptor;
}

export interface MatchResult {
  id: string;
  /** 0..1, 1 = identical features */
  similarity: number;
}

const W = { aspect: 1.6, elong: 1.0, fill: 1.4, openTop: 2.2, holes: 0.9, profile: 0.7 };
/** Larger = more forgiving similarity curve. */
const TAU = 0.35;

export function descriptorDistance(a: ShapeDescriptor, b: ShapeDescriptor): number {
  // aspect compared in log space (2x taller is as different as 2x shorter)
  const da = Math.log(a.aspect / b.aspect);
  let d =
    W.aspect * da * da +
    W.elong * (a.elong - b.elong) ** 2 +
    W.fill * (a.fill - b.fill) ** 2 +
    W.openTop * (a.openTop - b.openTop) ** 2 +
    W.holes * (Math.min(1, a.holes) - Math.min(1, b.holes)) ** 2;
  for (let s = 0; s < 5; s++) d += W.profile * (a.profile[s] - b.profile[s]) ** 2;
  return d;
}

export function rank(query: ShapeDescriptor, candidates: MatchCandidate[]): MatchResult[] {
  return candidates
    .map((c) => ({ id: c.id, similarity: Math.exp(-descriptorDistance(query, c.descriptor) / TAU) }))
    .sort((a, b) => b.similarity - a.similarity);
}
