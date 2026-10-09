/**
 * Knowledge Graph snapshot migrations. When KG_SCHEMA_VERSION goes from N to
 * N+1, add `MIGRATIONS[N]` (snapshot vN -> vN+1) and a unit test.
 */
import { KG_SCHEMA_VERSION, KGSnapshot } from './schema.js';

type AnySnapshot = { schemaVersion?: number } & Record<string, unknown>;

export const MIGRATIONS: Record<number, (s: AnySnapshot) => AnySnapshot> = {
  // 0 -> 1: pre-release snapshots had no log and no evidence arrays
  0: (s) => ({
    ...s,
    schemaVersion: 1,
    log: (s.log as unknown[]) ?? [],
    edges: ((s.edges as Record<string, unknown>[]) ?? []).map((e) => ({ evidence: [], status: 'active', ...e })),
  }),
};

/** Upgrade a stored snapshot; returns null if it is from a newer, unknown version. */
export function migrateSnapshot(raw: AnySnapshot): KGSnapshot | null {
  let s = raw;
  let v = s.schemaVersion ?? 0;
  if (v > KG_SCHEMA_VERSION) return null;
  while (v < KG_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return null;
    s = m(s);
    v = s.schemaVersion ?? v + 1;
  }
  return s as unknown as KGSnapshot;
}
