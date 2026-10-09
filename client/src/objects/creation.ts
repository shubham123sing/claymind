/**
 * Creation data model (see the brief, section 10). Persisted from Phase 3 on;
 * every saved format carries schemaVersion.
 */
import type { ShapeDescriptor } from './descriptor.js';
import type { MaterialGuess } from '../materials/materials.js';

export const CREATION_SCHEMA_VERSION = 1;

export interface Creation {
  schemaVersion: number;
  id: string;
  createdAt: number;
  descriptor: ShapeDescriptor;
  name: string;
  category: string;
  /** How the object was made. 'ai' arrives in Phase 4. */
  source: 'template' | 'ai' | 'sculpt-only';
  templateId: string | null;
  /** Similarity of the best template match (0..1). */
  matchScore: number;
  /** Best template even when not used (e.g. "looks a bit like a mug"). */
  bestGuess: { id: string; name: string; similarity: number } | null;
  materialId: string;
  materialConfidence: number;
  materialGuesses: MaterialGuess[];
  massKg: number;
  sizeCm: [number, number, number];
  volumeCm3: number;
  /** Seconds from "Bring to life" to the object existing. */
  timeToObject: number;
  kgNodeIds: string[];
}

let counter = 0;
export function newCreationId(): string {
  counter++;
  return `c_${Date.now().toString(36)}_${counter}`;
}
