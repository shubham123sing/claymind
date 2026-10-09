/**
 * Sculpt engine: SDF grid + chunk mesher + undo/redo.
 * History stores strokes (not meshes). Undo restores the nearest checkpoint
 * snapshot and replays the remaining actions, then re-meshes only chunks whose
 * samples changed. Pure logic: runs in the sculpt worker and in node tests.
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
}

const CHECKPOINT_EVERY = 8;
const MAX_CHECKPOINTS = 12;

export class SculptEngine {
  grid: SdfGrid;
  private mesher: ChunkMesher;
  private actions: Stroke[][] = [];
  private redoStack: Stroke[][] = [];
  /** key = number of actions applied when the snapshot was taken. */
  private checkpoints = new Map<number, Float32Array>();
  private currentAction = -1;
  private chunkVolume: Float64Array;
  private chunkBounds: Float32Array;
  private prevScratch: Float32Array;

  constructor(res: number, private size: number, private lump: LumpSpec) {
    this.grid = new SdfGrid(res, size);
    this.mesher = new ChunkMesher(this.grid);
    this.chunkVolume = new Float64Array(this.grid.chunksPerAxis ** 3);
    this.chunkBounds = new Float32Array(this.grid.chunksPerAxis ** 3 * 6).fill(Infinity);
    this.prevScratch = new Float32Array(this.grid.data.length);
    this.fillInitial(this.grid);
    this.checkpoints.set(0, this.grid.data.slice());
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
    this.grid.brush(s.op, s.x, s.y, s.z, s.r, s.dx ?? 0, s.dy ?? 0, s.dz ?? 0);
  }

  /** Apply strokes belonging to `actionId`. A new id starts a new undoable action. */
  apply(actionId: number, strokes: Stroke[]): void {
    if (actionId !== this.currentAction) {
      this.currentAction = actionId;
      const n = this.actions.length;
      this.redoStack.length = 0;
      for (const key of [...this.checkpoints.keys()]) if (key > n) this.checkpoints.delete(key);
      if (n > 0 && n % CHECKPOINT_EVERY === 0 && !this.checkpoints.has(n)) this.saveCheckpoint(n);
      this.actions.push([]);
    }
    const action = this.actions[this.actions.length - 1];
    for (const s of strokes) {
      action.push(s);
      this.applyStroke(s);
    }
  }

  private saveCheckpoint(n: number): void {
    this.checkpoints.set(n, this.grid.data.slice());
    if (this.checkpoints.size > MAX_CHECKPOINTS) {
      // drop the oldest non-zero checkpoint; undo far back just replays more
      const keys = [...this.checkpoints.keys()].filter((k) => k !== 0).sort((a, b) => a - b);
      this.checkpoints.delete(keys[0]);
    }
  }

  undo(): boolean {
    if (this.actions.length === 0) return false;
    this.redoStack.push(this.actions.pop()!);
    this.currentAction = -1;
    this.rebuild();
    return true;
  }

  redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;
    // brushes (and 'reset') mark their own dirty chunks while re-applying
    this.actions.push(action);
    for (const s of action) this.applyStroke(s);
    this.currentAction = -1;
    return true;
  }

  private rebuild(): void {
    this.prevScratch.set(this.grid.data);
    let best = 0;
    for (const key of this.checkpoints.keys()) if (key <= this.actions.length && key > best) best = key;
    this.grid.data.set(this.checkpoints.get(best)!);
    for (let a = best; a < this.actions.length; a++) for (const s of this.actions[a]) this.applyStroke(s);
    this.grid.dirty.fill(0);
    this.grid.markChangedSince(this.prevScratch);
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
    const base = new SdfGrid(res, this.size);
    this.fillInitial(base);
    this.checkpoints.clear();
    this.checkpoints.set(0, base.data);
    this.checkpoints.set(this.actions.length, this.grid.data.slice());
    this.currentAction = -1;
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
      canUndo: this.actions.length > 0,
      canRedo: this.redoStack.length > 0,
      res: this.grid.res,
    };
  }

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
