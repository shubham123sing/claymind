/**
 * Template library. Every *.json in ./templates is picked up automatically:
 * adding a template = dropping one file there (see docs/EXTENDING.md).
 */
import type { CsgNode } from './csg.js';
import type { Priors } from '../materials/materials.js';

export interface TemplateDef {
  schemaVersion: number;
  id: string;
  name: string;
  category: string;
  materialPriors: Priors;
  tags: string[];
  /** Procedural geometry (SDF CSG tree, metres, base at y = 0). */
  sdf: CsgNode;
}

const modules = import.meta.glob<{ default: TemplateDef }>('./templates/*.json', { eager: true });

export const TEMPLATES: TemplateDef[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id));

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
