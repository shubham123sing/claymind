/**
 * Client-side AI result cache (IndexedDB 'ai' store): the same shape is never
 * sent twice. Key = quantised shape descriptor + provider + pipeline version,
 * so a similar-enough re-sculpt reuses the earlier answer and model instantly.
 * This is the honest "gets faster with use" mechanism (no model training).
 */
import type { ShapeDescriptor } from '../objects/descriptor.js';
import { idbGet, idbSet } from '../storage/idb.js';
import type { DescribeResult } from './types.js';

export const AI_PIPELINE_VERSION = 1;

export interface AiCacheEntry {
  key: string;
  describe: DescribeResult;
  glb: ArrayBuffer | null;
  savedAt: number;
}

/** Coarse quantisation: shape features to 0.1, size to 2 cm buckets. */
export function aiCacheKey(d: ShapeDescriptor, scale: number, provider: string): string {
  const q = (v: number, step: number) => Math.round(v / step);
  const parts = [
    q(d.aspect, 0.1), q(d.elong, 0.1), q(d.fill, 0.1), q(d.openTop, 0.15), Math.min(1, d.holes),
    ...d.profile.map((p) => q(p, 0.15)),
    ...d.extents.map((e) => q(e * scale * 100, 2)),
  ];
  return `v${AI_PIPELINE_VERSION}:${provider}:${parts.join(',')}`;
}

export async function getCached(key: string): Promise<AiCacheEntry | null> {
  try {
    return (await idbGet<AiCacheEntry>('ai', key)) ?? null;
  } catch {
    return null;
  }
}

export async function putCached(entry: AiCacheEntry): Promise<void> {
  try {
    await idbSet('ai', entry.key, entry);
  } catch {
    /* cache is best-effort */
  }
}
