/**
 * Sculpt engine: SDF grid + chunk mesher + undo/redo.
 * History stores strokes (not meshes). Undo restores the nearest checkpoint
 * snapshot and replays the remaining actions, then re-meshes only chunks whose
 * samples changed. Pure logic: runs in the sculpt worker and in node tests.
 * Multiplayer (Update 3): every action has an owner, so undo / redo are per player
 * (a player's last action is taken out wherever it is and the rest is replayed); every
 * client applies the same actions in the same order, so they all get the same clay.
 * export / import / checksum carry the clay to a late joiner and detect drift.
 */
import { ChunkMesh, ChunkMesher, meshVolume } from './marching-cubes.js';
import { BrushOp, SdfGrid } from './sdf-grid.js';

/** One brush application in grid-local metres. `d*` only used by 'drag'. */
export interface Stroke {
  op: BrushOp | 'reset';
  x: number;
  y: number;
  z: number;
  r: number;
  dx?: number;
  dy?: number;
  dz?: number;
  /** add only: lay down clay of this piece (a new piece's first lump). */
  piece?: number;
  /** paint only: colour 0xRRGGBB. */
  rgb?: number;
}

export interface LumpSpec {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface MeshUpdate {
  chunks: ChunkMesh[];
  /** Grid-local AABB of the clay surface [minX,minY,minZ,maxX,maxY,maxZ], or null if empty. */
  aabb: number[] | null;
  /** Enclosed volume in m^3 (grid-local scale). */
  volume: number;
  canUndo: boolean;
  canRedo: boolean;
  res: number;
  /** Bit i set = piece i has clay. */
  piecesMask: number;
}

interface Snapshot {
  data: Float32Array;
  labels: Uint8Array;
  paint: Uint8Array;
}

export interface SculptAction {
  key: string;
  owner: string;
  strokes: Stroke[];
}

/** Everything a late joiner needs: the grid, the history (for undo) and how it started. */
export interface SculptSnapshot extends Snapshot {
  res: number;
  size: number;
  lump: LumpSpec;
  actions: SculptAction[];
}

/** The owner of single-player actions. */
export const LOCAL = 'local';
/** Actions searched back for a stroke's action key (strokes of one gesture arrive in batches). */
const ACTION_LOOKBACK = 64;

const CHECKPOINT_EVERY = 8;
const MAX_CHECKPOINTS = 12;

export class SculptEngine {
  grid: SdfGrid;
  private mesher: ChunkMesher;
  private actions: SculptAction[] = [];
  private redoStacks = new Map<string, SculptAction[]>();
  /** Whose undo / redo the mesh update reports (this client's player). */
  me = LOCAL;
  /** key = number of actions applied when the snapshot was taken. */
  private checkpoints = new Map<number, Snapshot>();
  private chunkVolume: Float64Array;
  private chunkBounds: Float32Array;
  private prevScratch: Float32Array;
  private prevLabels: Uint8Array;
  private prevPaint: Uint8Array;

  constructor(res: number, private size: number, private lump: LumpSpec) {
    this.grid = new SdfGrid(res, size);
    this.mesher = new ChunkMesher(this.grid);
    this.chunkVolume = new Float64Array(this.grid.chunksPerAxis ** 3);
    this.chunkBounds = new Float32Array(this.grid.chunksPerAxis ** 3 * 6).fill(Infinity);
    this.prevScratch = new Float32Array(this.grid.data.length);
    this.prevLabels = new Uint8Array(this.grid.data.length);
    this.prevPaint = new Uint8Array(this.grid.data.length * 4);
    this.fillInitial(this.grid);
    this.checkpoints.set(0, this.snapshot());
  }

  private snapshot(): Snapshot {
    return { data: this.grid.data.slice(), labels: this.grid.labels.slice(), paint: this.grid.paint.slice() };
  }

  get res(): number {
    return this.grid.res;
  }

  private fillInitial(grid: SdfGrid): void {
    grid.fillSphere(this.lump.x, this.lump.y, this.lump.z, this.lump.r);
  }

  private applyStroke(s: Stroke): void {
    if (s.op === 'reset') {
      this.fillInitial(this.grid);
      return;
    }
    if (s.op === 'paint' || s.op === 'erase') this.grid.paintBrush(s.x, s.y, s.z, s.r, s.op === 'erase' ? null : s.rgb ?? 0xffffff, s.dx ?? 0, s.dy ?? 0, s.dz ?? 0);
    else this.grid.brush(s.op, s.x, s.y, s.z, s.r, s.dx ?? 0, s.dy ?? 0, s.dz ?? 0, s.piece);
  }

  /** Drop checkpoints taken after the first `n` actions (they no longer match the history). */
  private dropCheckpointsAfter(n: number): void {
    for (const key of [...this.checkpoints.keys()]) if (key > n) this.checkpoints.delete(key);
  }

  /** Apply strokes belonging to action `key` of `owner` (a new key starts a new undoable action). */
  apply(key: string | number, strokes: Stroke[], owner = LOCAL): void {
    const k = typeof key === 'number' ? `${owner}:${key}` : key;
    let i = -1;
    for (let j = this.actions.length - 1; j >= Math.max(0, this.actions.length - ACTION_LOOKBACK); j--) {
      if (this.actions[j].key === k) {
        i = j;
        break;
      }
    }
    if (i < 0) {
      const n = this.actions.length;
      this.redoStacks.delete(owner);
      this.dropCheckpointsAfter(n);
      if (n > 0 && n % CHECKPOINT_EVERY === 0 && !this.checkpoints.has(n)) this.saveCheckpoint(n);
      this.actions.push({ key: k, owner, strokes: [] });
      i = n;
    } else if (i < this.actions.length - 1) this.dropCheckpointsAfter(i); // another player acted since
    const action = this.actions[i];
    for (const s of strokes) {
      action.strokes.push(s);
      this.applyStroke(s);
    }
  }

  private saveCheckpoint(n: number): void {
    this.checkpoints.set(n, this.snapshot());
    if (this.checkpoints.size > MAX_CHECKPOINTS) {
      // drop the oldest non-zero checkpoint; undo far back just replays more
      const keys = [...this.checkpoints.keys()].filter((k) => k !== 0).sort((a, b) => a - b);
      this.checkpoints.delete(keys[0]);
    }
  }

  /** Undo `owner`'s last action (others' later actions stay). */
  undo(owner = LOCAL): boolean {
    let i = -1;
    for (let j = this.actions.length - 1; j >= 0; j--) if (this.actions[j].owner === owner) (i = j), (j = -1);
    if (i < 0) return false;
    const [action] = this.actions.splice(i, 1);
    if (!this.redoStacks.has(owner)) this.redoStacks.set(owner, []);
    this.redoStacks.get(owner)!.push(action);
    this.dropCheckpointsAfter(i);
    this.rebuild();
    return true;
  }

  redo(owner = LOCAL): boolean {
    const action = this.redoStacks.get(owner)?.pop();
    if (!action) return false;
    // brushes (and 'reset') mark their own dirty chunks while re-applying
    this.dropCheckpointsAfter(this.actions.length);
    this.actions.push(action);
    for (const s of action.strokes) this.applyStroke(s);
    return true;
  }

  /** The clay and its history, for a player who joins later. */
  exportState(): SculptSnapshot {
    return { ...this.snapshot(), res: this.grid.res, size: this.size, lump: { ...this.lump }, actions: this.actions.map((a) => ({ ...a, strokes: [...a.strokes] })) };
  }

  /** Take over a snapshot exported by another client (same grid, same history). */
  importState(snap: SculptSnapshot): void {
    if (snap.res !== this.grid.res || snap.size !== this.size) {
      this.size = snap.size;
      this.resample(snap.res);
    }
    this.lump = { ...snap.lump };
    const base = new SdfGrid(snap.res, this.size);
    base.fillSphere(this.lump.x, this.lump.y, this.lump.z, this.lump.r);
    this.checkpoints.clear();
    this.checkpoints.set(0, { data: base.data, labels: base.labels, paint: base.paint });
    this.actions = snap.actions.map((a) => ({ ...a, strokes: [...a.strokes] }));
    this.redoStacks.clear();
    this.grid.data.set(snap.data);
    this.grid.labels.set(snap.labels);
    this.grid.paint.set(snap.paint);
    this.grid.markAllDirty();
  }

  /** A hash of the clay (shape to 0.01 mm, pieces, paint): equal on every client in sync. */
  checksum(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v & 0xffff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xffff;
      h = Math.imul(h, 0x01000193);
    };
    const { data, labels, paint } = this.grid;
    for (let i = 0; i < data.length; i++) mix(Math.round(data[i] * 1e5));
    for (let i = 0; i < labels.length; i++) mix(labels[i]);
    for (let i = 0; i < paint.length; i += 4) mix(paint[i] | (paint[i + 1] << 8) | (paint[i + 2] << 16) | (paint[i + 3] << 24));
    return h >>> 0;
  }

  private rebuild(): void {
    this.prevScratch.set(this.grid.data);
    this.prevLabels.set(this.grid.labels);
    this.prevPaint.set(this.grid.paint);
    let best = 0;
    for (const key of this.checkpoints.keys()) if (key <= this.actions.length && key > best) best = key;
    const cp = this.checkpoints.get(best)!;
    this.grid.data.set(cp.data);
    this.grid.labels.set(cp.labels);
    this.grid.paint.set(cp.paint);
    for (let a = best; a < this.actions.length; a++) for (const s of this.actions[a].strokes) this.applyStroke(s);
    this.grid.dirty.fill(0);
    this.grid.markChangedSince(this.prevScratch, this.prevLabels, this.prevPaint);
  }

  /** Change grid resolution, keeping the current shape and the full history. */
  resample(res: number): void {
    const old = this.grid;
    this.grid = new SdfGrid(res, this.size);
    this.grid.resampleFrom(old);
    this.mesher = new ChunkMesher(this.grid);
    this.chunkVolume = new Float64Array(this.grid.chunksPerAxis ** 3);
    this.chunkBounds = new Float32Array(this.grid.chunksPerAxis ** 3 * 6).fill(Infinity);
    this.prevScratch = new Float32Array(this.grid.data.length);
    this.prevLabels = new Uint8Array(this.grid.data.length);
    this.prevPaint = new Uint8Array(this.grid.data.length * 4);
    const base = new SdfGrid(res, this.size);
    this.fillInitial(base);
    this.checkpoints.clear();
    this.checkpoints.set(0, { data: base.data, labels: base.labels, paint: base.paint });
    this.checkpoints.set(this.actions.length, this.snapshot());
  }

  /** Re-mesh dirty chunks and return them plus aggregate stats. */
  update(): MeshUpdate {
    const chunks = this.mesher.meshDirty();
    for (const c of chunks) {
      this.chunkVolume[c.chunk] = meshVolume(c.positions);
      const b = this.chunkBounds, o = c.chunk * 6;
      if (c.positions.length === 0) {
        b[o] = Infinity;
        continue;
      }
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      const p = c.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
        if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
        if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2];
      }
      b[o] = x0; b[o + 1] = y0; b[o + 2] = z0; b[o + 3] = x1; b[o + 4] = y1; b[o + 5] = z1;
    }
    return {
      chunks,
      aabb: this.aabb(),
      volume: this.volume(),
      canUndo: this.actions.some((a) => a.owner === this.me),
      canRedo: (this.redoStacks.get(this.me)?.length ?? 0) > 0,
      res: this.grid.res,
      piecesMask: chunks.length ? (this.mask = this.grid.piecesMask()) : this.mask,
    };
  }

  private mask = 1;

  private volume(): number {
    let v = 0;
    for (let i = 0; i < this.chunkVolume.length; i++) v += this.chunkVolume[i];
    return v;
  }

  private aabb(): number[] | null {
    const b = this.chunkBounds;
    const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let o = 0; o < b.length; o += 6) {
      if (b[o] === Infinity) continue;
      for (let a = 0; a < 3; a++) {
        out[a] = Math.min(out[a], b[o + a]);
        out[a + 3] = Math.max(out[a + 3], b[o + a + 3]);
      }
    }
    return out[0] === Infinity ? null : out;
  }

  /** Full-state snapshot of all non-empty chunk meshes (after resample/init). */
  remeshAll(): MeshUpdate {
    this.grid.markAllDirty();
    return this.update();
  }
}
