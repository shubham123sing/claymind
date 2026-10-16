/**
 * Main-thread side of the sculpt worker. Coalesces strokes (one request in
 * flight), tracks timings, and quietly lowers grid resolution if the worker
 * cannot keep up on this device (budget from the brief: keep sculpting smooth).
 */
import type { LumpSpec, SculptSnapshot, Stroke } from './sculpt-engine.js';
import type { BakeResponse, DataResponse, SculptRequest, SculptResponse, WorkerResponse } from './sdf-worker.js';

const DOWNGRADE_MS = 14; // worker p90 above ~one Quest frame -> lower resolution
const RES_STEPS = [64, 56, 48, 40, 32];

export class SculptClient {
  private worker = new Worker(new URL('./sdf-worker.ts', import.meta.url), { type: 'module' });
  private pending: { action: number | string; strokes: Stroke[]; owner?: string }[] = [];
  /**
   * Multiplayer: set while in a room. Own strokes, undo and redo go out through it instead of
   * the worker; they come back from the room in its order (applyRemote, undoOf, redoOf).
   */
  share: ((edit: { kind: 'strokes'; action: number; strokes: Stroke[] } | { kind: 'undo' | 'redo' }) => void) | null = null;
  /** No automatic resolution changes (every client in a room must keep the same grid). */
  lockRes = false;
  private dataWaiters = new Map<SculptRequest, (m: DataResponse) => void>();
  private control: SculptRequest[] = [];
  private inFlight = 0;
  private nextId = 1;
  private sentAt = new Map<number, number>();
  private actionId = 0;
  private workerMs: number[] = [];
  res: number;
  /** Rolling stats for the debug HUD. */
  stats = { workerP50: 0, workerP90: 0, rttP50: 0, strokesQueued: 0, downgrades: 0 };
  private rtt: number[] = [];
  last: SculptResponse | null = null;
  private bakeWaiters: { msg: SculptRequest; resolve: (m: BakeResponse) => void }[] = [];

  constructor(res: number, size: number, lump: LumpSpec, private onMesh: (m: SculptResponse, resChanged: boolean) => void) {
    this.res = res;
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === 'baked') this.receiveBake(e.data);
      else if (e.data.type === 'data') this.receiveData(e.data);
      else this.receive(e.data);
    };
    this.post({ type: 'init', id: this.nextId++, res, size, lump });
  }

  beginAction(): number {
    return ++this.actionId;
  }

  push(stroke: Stroke): void {
    // devtools: `window.__strokeLog = []` records strokes for offline replay
    (globalThis as { __strokeLog?: Stroke[] }).__strokeLog?.push({ ...stroke });
    if (this.share) return this.share({ kind: 'strokes', action: this.actionId, strokes: [stroke] });
    const tail = this.pending[this.pending.length - 1];
    if (tail && tail.action === this.actionId) tail.strokes.push(stroke);
    else this.pending.push({ action: this.actionId, strokes: [stroke] });
  }

  undo(): void {
    if (this.share) return this.share({ kind: 'undo' });
    this.undoOf();
  }

  redo(): void {
    if (this.share) return this.share({ kind: 'redo' });
    this.redoOf();
  }

  // ---------- multiplayer (edits in the room's order) ----------

  /** Someone's strokes (or mine, back from the room). */
  applyRemote(owner: string, action: string, strokes: Stroke[]): void {
    const tail = this.pending[this.pending.length - 1];
    if (tail && tail.action === action && tail.owner === owner) tail.strokes.push(...strokes);
    else this.pending.push({ action, strokes: [...strokes], owner });
  }

  undoOf(owner?: string): void {
    this.flushPendingAsControl();
    this.control.push({ type: 'undo', id: 0, owner });
    this.flush();
  }

  redoOf(owner?: string): void {
    this.flushPendingAsControl();
    this.control.push({ type: 'redo', id: 0, owner });
    this.flush();
  }

  /** Whose undo / redo buttons the mesh updates enable. */
  setOwner(owner: string): void {
    this.control.push({ type: 'me', id: 0, owner });
    this.flush();
  }

  private request(msg: SculptRequest): Promise<DataResponse> {
    return new Promise((resolve) => {
      this.flushPendingAsControl();
      this.dataWaiters.set(msg, resolve);
      this.control.push(msg);
      this.flush();
    });
  }

  /** The clay and its history, after every edit queued so far. */
  async exportState(): Promise<SculptSnapshot> {
    return (await this.request({ type: 'export', id: 0 })).snap!;
  }

  /** The clay after every edit queued so far, as a number (equal on every client in sync). */
  async checksum(): Promise<number> {
    return (await this.request({ type: 'checksum', id: 0 })).checksum!;
  }

  importState(snap: SculptSnapshot): void {
    this.pending = [];
    this.control.push({ type: 'import', id: 0, snap });
    this.flush();
  }

  private receiveData(m: DataResponse): void {
    this.inFlight--;
    this.sentAt.delete(m.id);
    for (const [msg, resolve] of this.dataWaiters) {
      if (msg.id === m.id) {
        this.dataWaiters.delete(msg);
        resolve(m);
      }
    }
    this.flush();
  }

  /** Keep ordering: strokes queued before an undo must reach the worker first. */
  /**
   * Bake the current sculpt into an object (template match or the sculpt itself).
   * Queued behind pending strokes so it sees the latest shape.
   */
  bake(opts: { scale: number; threshold: number; pieces: number; seed: number }): Promise<BakeResponse> {
    return new Promise((resolve) => {
      this.flushPendingAsControl();
      const msg: SculptRequest = { type: 'bake', id: 0, ...opts };
      this.bakeWaiters.push({ msg, resolve });
      this.control.push(msg);
      this.flush();
    });
  }

  private receiveBake(m: BakeResponse): void {
    this.inFlight--;
    this.sentAt.delete(m.id);
    const i = this.bakeWaiters.findIndex((w) => w.msg.id === m.id);
    if (i >= 0) this.bakeWaiters.splice(i, 1)[0].resolve(m);
    this.flush();
  }

  private flushPendingAsControl(): void {
    for (const p of this.pending) this.control.push({ type: 'strokes', id: 0, action: p.action, strokes: p.strokes, owner: p.owner });
    this.pending = [];
  }

  flush(): void {
    if (this.inFlight > 0) return;
    this.flushPendingAsControl();
    for (const msg of this.control) {
      msg.id = this.nextId++;
      this.post(msg);
    }
    this.control = [];
  }

  private post(msg: SculptRequest): void {
    this.inFlight++;
    this.sentAt.set(msg.id, performance.now());
    this.worker.postMessage(msg);
  }

  private receive(m: SculptResponse): void {
    this.inFlight--;
    const sent = this.sentAt.get(m.id);
    this.sentAt.delete(m.id);
    const resChanged = this.last !== null && m.res !== this.last.res;
    this.last = m;
    this.res = m.res;
    this.onMesh(m, resChanged || m.id === 1);
    if (m.id !== 1 && m.chunks.length > 0) {
      record(this.workerMs, m.brushMs + m.meshMs);
      if (sent !== undefined) record(this.rtt, performance.now() - sent);
      this.stats.workerP50 = pct(this.workerMs, 0.5);
      this.stats.workerP90 = pct(this.workerMs, 0.9);
      this.stats.rttP50 = pct(this.rtt, 0.5);
      this.maybeDowngrade();
    }
    this.flush();
  }

  private maybeDowngrade(): void {
    if (this.lockRes || this.workerMs.length < 40 || this.stats.workerP90 < DOWNGRADE_MS) return;
    const next = RES_STEPS.find((r) => r < this.res);
    if (!next) return;
    this.workerMs.length = 0;
    this.stats.downgrades++;
    console.info(`[sculpt] worker p90 ${this.stats.workerP90.toFixed(1)} ms > ${DOWNGRADE_MS}; resolution ${this.res} -> ${next}`);
    this.control.push({ type: 'resample', id: 0, res: next });
  }
}

function record(a: number[], v: number): void {
  a.push(v);
  if (a.length > 60) a.shift();
}

function pct(a: number[], p: number): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
