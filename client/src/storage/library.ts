/**
 * Saved creations in IndexedDB, with their pieces (meshes, paint, colliders,
 * breakage shards, frames), materials, colours, pose relative to the work
 * surface and a small thumbnail. Two stores:
 * - 'creations': the Library, only what the player chose to add (named copies);
 * - 'room': pinned creations, put back on the table after a reload (relative to
 *   the table, since anchors are unverified on Quest Browser).
 */
import type { BakedMesh, BakedPiece } from '../objects/bake.js';
import type { PartCollider } from '../objects/collider.js';
import type { Creation } from '../objects/creation.js';
import { idbDelete, idbGetAll, idbSet } from './idb.js';

export const LIBRARY_SCHEMA = 1;

export interface SavedPart {
  label: number;
  materialId: string;
  color: string | null;
  mesh: BakedMesh;
  shards: BakedPiece[];
  collider?: PartCollider;
  frame: { p: [number, number, number]; q: [number, number, number, number] };
}

export interface SavedCreation {
  schemaVersion: number;
  id: string;
  savedAt: number;
  creation: Creation;
  parts: SavedPart[];
  pinned: boolean;
  /** Pose in the work surface's frame: x/z from its centre (its axes), y above its top; q with its yaw removed. */
  pose: { p: [number, number, number]; q: [number, number, number, number] };
  /** JPEG data URL. */
  thumb: string;
}

const TIMEOUT_MS = 2500;
const withTimeout = <T>(p: Promise<T>, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), TIMEOUT_MS))]);

type Store = 'creations' | 'room';

export function saveToLibrary(s: SavedCreation, store: Store = 'creations'): Promise<void> {
  return withTimeout(idbSet(store, s.id, s), undefined);
}

export function deleteFromLibrary(id: string, store: Store = 'creations'): Promise<void> {
  return withTimeout(idbDelete(store, id), undefined);
}

export async function loadLibrary(store: Store = 'creations'): Promise<SavedCreation[]> {
  const all = await withTimeout(idbGetAll<SavedCreation>(store), []);
  return all.filter((s) => s && s.schemaVersion === LIBRARY_SCHEMA && Array.isArray(s.parts)).sort((a, b) => b.savedAt - a.savedAt);
}

/** Next free default name: "Clay 1", "Clay 2", ... */
export function nextClayName(names: string[]): string {
  let n = 0;
  for (const name of names) {
    const m = /^Clay (\d+)$/.exec(name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Clay ${n + 1}`;
}

/** A copy of a saved creation under a new id (and name), so playing with it never changes the original. */
export function copySaved(s: SavedCreation, id: string, name = s.creation.name): SavedCreation {
  const c = structuredClone(s);
  c.id = id;
  c.creation.id = id;
  c.creation.name = name;
  c.savedAt = Date.now();
  return c;
}

/** World pose -> surface frame (and back), for poses that survive the table being found again at a new spot. */
export interface SurfaceFrame {
  centerX: number;
  centerZ: number;
  topY: number;
  yaw: number;
}

type V3 = [number, number, number];
type Q4 = [number, number, number, number];

/** Quaternion of a rotation by `yaw` around +Y. */
const yawQ = (yaw: number): Q4 => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

function mulQ(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function toSurfaceFrame(s: SurfaceFrame, p: V3, q: Q4): { p: V3; q: Q4 } {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const dx = p[0] - s.centerX, dz = p[2] - s.centerZ;
  // world = Ry(yaw) * local  =>  local = Ry(-yaw) * world (see surface-system's nearestSurfacePoint)
  return { p: [dx * c - dz * sn, p[1] - s.topY, dx * sn + dz * c], q: mulQ(yawQ(-s.yaw), q) };
}

export function fromSurfaceFrame(s: SurfaceFrame, p: V3, q: Q4): { p: V3; q: Q4 } {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { p: [s.centerX + p[0] * c + p[2] * sn, s.topY + p[1], s.centerZ - p[0] * sn + p[2] * c], q: mulQ(yawQ(s.yaw), q) };
}
