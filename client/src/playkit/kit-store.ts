/**
 * Play Kit storage: the player's toy box (kit items: their own creations with a
 * role tag and measured stats) and Sets (a saved arrangement on the table,
 * optionally with the game it plays). Separate from the Library: one creation
 * can be in both. IndexedDB stores 'kit' and 'sets'; download / import as a
 * `.claymind.json` kit file (same typed-array encoding and checks as a project).
 */
import { checkSaved, decodeJson, encodeJson, ImportError, MAX_KIT_BYTES } from '../export/project-file.js';
import { getMaterial } from '../materials/materials.js';
import { copySaved, type SavedCreation } from '../storage/library.js';
import { idbDelete, idbGetAll, idbSet } from '../storage/idb.js';
import { FALLBACK_SHAPES, ROLE_TAGS, type FallbackShape, type GameSpec, type RoleSpec, type RoleTag } from './game-spec.js';

export const KIT_SCHEMA = 1;
export const KIT_FILE_FORMAT = 'claymind-kit';

export interface KitStats {
  /** Bounding box, cm (x, y, z as made). */
  sizeCm: [number, number, number];
  massKg: number;
  materials: string[];
  parts: number;
  /** volume / bounding-box volume (sphere 0.52, cube 1, a cup much less). */
  fill: number;
}

export interface KitItem {
  schema: number;
  id: string;
  name: string;
  role: RoleTag;
  data: SavedCreation;
  stats: KitStats;
  addedAt: number;
  /** What the optional vision check saw in the game's own pictures of it (a suggestion only). */
  vision?: { looksLike: string; roles: RoleTag[]; confidence: number };
}

export interface SetPiece {
  /** A kit item, or a built-in shape. */
  kitId: string | null;
  builtin?: { shape: FallbackShape; material: string };
  /** Game role and index it plays (for games). */
  role?: string;
  /** Pose in the work surface's frame (like the Library). */
  pose: { p: [number, number, number]; q: [number, number, number, number] };
  pinned: boolean;
}

export interface PlaySet {
  schema: number;
  id: string;
  name: string;
  savedAt: number;
  pieces: SetPiece[];
  /** The game this Set plays (a built-in template) and which kit item plays each role (null = built-in shape). */
  game?: { templateId: string; roleMap: Record<string, string | null> };
  physics: { gravity: number };
}

/** Bounding box of all pieces in the object's frame (m). */
export function measure(s: SavedCreation): KitStats {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const part of s.parts) {
    const [qx, qy, qz, qw] = part.frame.q, [px, py, pz] = part.frame.p, pos = part.mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      // v' = v + 2w(q x v) + 2 q x (q x v), then translate by the piece frame
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x;
      const v = [
        x + 2 * qw * cx + 2 * (qy * cz - qz * cy) + px,
        y + 2 * qw * cy + 2 * (qz * cx - qx * cz) + py,
        z + 2 * qw * cz + 2 * (qx * cy - qy * cx) + pz,
      ];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    }
  }
  const size = [0, 1, 2].map((k) => Math.max(0, hi[k] - lo[k])) as [number, number, number];
  const box = size[0] * size[1] * size[2];
  const volume = (s.creation.volumeCm3 ?? 0) / 1e6;
  return {
    sizeCm: size.map((v) => Math.round(v * 1000) / 10) as [number, number, number],
    massKg: Math.round((s.creation.massKg ?? 0) * 1000) / 1000,
    materials: [...new Set(s.parts.map((p) => p.materialId))],
    parts: s.parts.length,
    fill: box > 0 ? Math.min(1, Math.round((volume / box) * 100) / 100) : 0,
  };
}

/** A first guess at what a shape is for (the player can change it). */
export function suggestRole(st: KitStats): RoleTag {
  const d = [...st.sizeCm].sort((a, b) => a - b), [small, mid, big] = d;
  const flat = small / Math.max(big, 0.1), long = mid / Math.max(big, 0.1);
  const tall = st.sizeCm[1] / Math.max(big, 0.1);
  if (flat < 0.15 && long >= 0.5 && big >= 15) return 'board'; // thin and wide
  if (st.fill < 0.45 && tall > 0.4 && big >= 4) return 'container';
  if (long < 0.35 && big >= 15) return 'launcher';
  if (big <= 8) return 'piece';
  return 'obstacle';
}

/** Size of each built-in shape (largest dimension, m), to compare kit items with. */
export const FALLBACK_SIZE: Record<FallbackShape, number> = {
  block: 0.04, ball: 0.036, marble: 0.02, disc: 0.036, coin: 0.028, board: 0.36, cup: 0.07, ramp: 0.32,
};

/** Does the shape suit what the built-in shape does (stack, roll, slide, hold)? */
export function shapeFits(st: KitStats, shape: FallbackShape): boolean {
  const d = [...st.sizeCm].sort((a, b) => a - b), [small, mid, big] = d;
  const even = small / Math.max(big, 0.1), long = mid / Math.max(big, 0.1);
  switch (shape) {
    case 'block': return st.fill >= 0.65; // stacks: flat faces
    case 'ball': case 'marble': return even >= 0.7 && st.fill < 0.7; // rolls
    case 'coin': case 'disc': return even < 0.6 && long > 0.7; // slides flat
    case 'board': return even < 0.15 && long >= 0.5;
    case 'cup': return st.fill < 0.6;
    case 'ramp': return long < 0.5;
  }
}

/** How well a kit item fits a role: tag match first, then shape and size. Null = it does not fit. */
export function fitScore(item: KitItem, role: RoleSpec): number | null {
  const t = role.tags.indexOf(item.role);
  if (t < 0 || !shapeFits(item.stats, role.fallback)) return null;
  const big = Math.max(...item.stats.sizeCm) / 100;
  const ratio = Math.max(big, 0.005) / FALLBACK_SIZE[role.fallback];
  // several pieces stand close together in a layout: a much bigger toy would overlap its neighbours
  if (ratio > (role.count > 1 ? 1.6 : 3) || ratio < 1 / 3) return null;
  return 3 - t - Math.abs(Math.log(ratio));
}

/** Best kit item for each role (null = use the built-in shape). */
export function suggestRoleMap(spec: GameSpec, kit: KitItem[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const role of spec.roles) {
    let best: KitItem | null = null, bestScore = -Infinity;
    for (const item of kit) {
      const s = fitScore(item, role);
      if (s !== null && s > bestScore) { best = item; bestScore = s; }
    }
    out[role.id] = best?.id ?? null;
  }
  return out;
}

export function makeKitItem(s: SavedCreation, name: string, id = `kit_${Date.now().toString(36)}`): KitItem {
  const data = copySaved(s, id, name);
  data.pinned = false;
  const stats = measure(data);
  return { schema: KIT_SCHEMA, id, name, role: suggestRole(stats), data, stats, addedAt: Date.now() };
}

// ---------- storage ----------

export async function loadKit(): Promise<KitItem[]> {
  return (await idbGetAll<KitItem>('kit')).filter((k) => k?.schema === KIT_SCHEMA).sort((a, b) => a.addedAt - b.addedAt);
}
export const saveKitItem = (k: KitItem) => idbSet('kit', k.id, k);
export const deleteKitItem = (id: string) => idbDelete('kit', id);
export async function loadSets(): Promise<PlaySet[]> {
  return (await idbGetAll<PlaySet>('sets')).filter((s) => s?.schema === KIT_SCHEMA).sort((a, b) => b.savedAt - a.savedAt);
}
export const saveSet = (s: PlaySet) => idbSet('sets', s.id, s);
export const deleteSet = (id: string) => idbDelete('sets', id);

// ---------- file ----------

export function kitToJson(items: KitItem[], sets: PlaySet[]): string {
  return encodeJson({ format: KIT_FILE_FORMAT, version: KIT_SCHEMA, items, sets });
}

const isVec = (x: unknown, n: number) => Array.isArray(x) && x.length === n && x.every((v) => typeof v === 'number' && Number.isFinite(v));

/** Parse and check a kit file; throws ImportError with a player-readable reason. */
export function kitFromJson(text: string): { items: KitItem[]; sets: PlaySet[] } {
  const d = decodeJson(text, MAX_KIT_BYTES) as { format?: unknown; version?: unknown; items?: unknown[]; sets?: unknown[] };
  if (d?.format !== KIT_FILE_FORMAT) throw new ImportError('Not a ClayMind kit file');
  if (d.version !== KIT_SCHEMA) throw new ImportError('Made by a newer ClayMind');
  if (!Array.isArray(d.items) || d.items.length > 50 || !Array.isArray(d.sets) || d.sets.length > 50) throw new ImportError('Damaged kit file');
  const items = d.items.map((raw) => {
    const k = raw as KitItem;
    if (k?.schema !== KIT_SCHEMA || typeof k.id !== 'string' || typeof k.name !== 'string' || !(ROLE_TAGS as readonly string[]).includes(k.role)) throw new ImportError('Damaged kit file');
    const data = checkSaved(k.data);
    return { ...k, name: k.name.slice(0, 40) || 'Toy', data, stats: measure(data) };
  });
  const ids = new Set(items.map((k) => k.id));
  const sets = d.sets.map((raw) => {
    const s = raw as PlaySet;
    if (s?.schema !== KIT_SCHEMA || typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.pieces) || s.pieces.length > 40) throw new ImportError('Damaged kit file');
    for (const p of s.pieces) {
      const ok = p && (p.kitId === null ? (FALLBACK_SHAPES as readonly string[]).includes(p.builtin?.shape ?? '') && getMaterial(p.builtin!.material).id === p.builtin!.material : ids.has(p.kitId));
      if (!ok || !isVec(p.pose?.p, 3) || !isVec(p.pose?.q, 4) || typeof p.pinned !== 'boolean') throw new ImportError('Damaged kit file');
    }
    return { ...s, name: s.name.slice(0, 40) || 'Set', physics: { gravity: 1 } };
  });
  return { items, sets };
}
