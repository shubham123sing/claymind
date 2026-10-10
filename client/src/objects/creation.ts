/**
 * Creation data model (see the brief, section 10). Persisted from Phase 3 on;
 * every saved format carries schemaVersion.
 */
import type { ShapeDescriptor } from './descriptor.js';
import type { MaterialGuess } from '../materials/materials.js';

export const CREATION_SCHEMA_VERSION = 2;

/** One clay piece of a creation with its own material (plan v3). */
export interface CreationPart {
  /** Piece label from the sculpt. */
  label: number;
  materialId: string;
  materialConfidence: number;
  /** Who chose the material: the local guess, the AI, or the player. */
  by: 'guess' | 'ai' | 'user';
  massKg: number;
  volumeCm3: number;
}

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
  /** Main material: the largest part's (what the brain and the AI see). */
  materialId: string;
  materialConfidence: number;
  materialGuesses: MaterialGuess[];
  /** Pieces and their materials; one entry for a single lump. */
  parts: CreationPart[];
  /** Total mass from computePhysicalProperties. */
  massKg: number;
  sizeCm: [number, number, number];
  volumeCm3: number;
  /** Seconds from "Bring to life" to the object existing. */
  timeToObject: number;
  kgNodeIds: string[];
  /** Transient (not persisted): one-line AI progress shown on the label. */
  aiStatus?: string;
}

/** Keep the main material in step with the parts (largest part by volume). */
export function syncMainMaterial(c: Creation): void {
  const main = [...c.parts].sort((a, b) => b.volumeCm3 - a.volumeCm3)[0];
  if (!main) return;
  c.materialId = main.materialId;
  c.materialConfidence = main.materialConfidence;
}

let counter = 0;
export function newCreationId(): string {
  counter++;
  return `c_${Date.now().toString(36)}_${counter}`;
}
