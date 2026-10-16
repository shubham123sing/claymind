/**
 * Building together (Update 3, Step C): one shared clay on the shared table.
 * - My strokes, Undo and Redo go to the room as edit operations (never the mesh); every
 *   client, me included, applies them when they come back, in the room's order, so all
 *   clays stay the same. Undo / Redo are per player (the engine takes out that player's
 *   last action and replays the rest).
 * - The clay sits at the table's centre, turned the same way for everyone; the grid
 *   resolution is fixed while in a room.
 * - A late joiner gets the host's snapshot (the clay, its history, and whatever other
 *   systems add: bodies, the game) plus the edits after it.
 * - Every 5 s the host sends a checksum of its clay; a client whose clay differs at the
 *   same edit asks for a resync and takes the host's snapshot.
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import type { SculptSnapshot, Stroke } from '../sculpt/sculpt-engine.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { packArray, unpackBytes, unpackFloats } from './codec.js';
import { room, type RoomMsg } from './room-client.js';
import { tableFrame } from './table-frame.js';

const CHECK_MS = 5000;

type Edit = { k: 's'; a: string; s: Stroke[] } | { k: 'u' } | { k: 'r' };

/** Other systems add their part of a late joiner's snapshot here (bodies, the game). */
export interface SnapshotPart {
  save(): Promise<unknown> | unknown;
  load(data: unknown): Promise<void> | void;
}
export const snapshotParts = new Map<string, SnapshotPart>();

export class SharedClaySystem extends createSystem({}) {
  /** the last room edit applied (or queued to the worker) */
  lastSeq = 0;
  private waiting = false;
  private buffered: RoomMsg[] = [];
  private outbox: Edit[] = [];
  private lastCheck = 0;
  private stats = { resyncs: 0, checks: 0, mismatches: 0 };
  private v = new Vector3();

  private get sculpt() {
    return this.world.getSystem(SculptSystem)!;
  }

  init(): void {
    snapshotParts.set('clay', {
      save: async () => packClay(await this.sculpt.sculptClient.exportState()),
      load: async (data) => this.sculpt.sculptClient.importState(await unpackClay(data as PackedClay)),
    });
    this.cleanupFuncs.push(
      bus.on('room:joined', (e) => this.begin(e.host)),
      bus.on('room:left', () => this.end()),
      room.on('op', (m) => (this.waiting ? this.buffered.push(m) : this.apply(m))),
      room.on('need_snapshot', (m) => void this.sendSnapshot(String(m.for))),
      room.on('snapshot', (m) => void this.receiveSnapshot(m)),
      room.on('check', (m) => void this.compare(m)),
    );
    Object.assign(globalThis, { __claySync: this }); // QA: stats, forced desync
  }

  private begin(host: boolean): void {
    const c = this.sculpt.sculptClient;
    c.lockRes = true;
    c.setOwner(room.me!.id);
    c.share = (edit) => {
      if (edit.kind === 'strokes') {
        const a = `${room.me!.id}:${edit.action}`, tail = this.outbox[this.outbox.length - 1];
        if (tail?.k === 's' && tail.a === a) tail.s.push(...edit.strokes);
        else this.outbox.push({ k: 's', a, s: [...edit.strokes] });
      } else this.outbox.push({ k: edit.kind === 'undo' ? 'u' : 'r' });
    };
    this.lastSeq = 0;
    this.waiting = !host; // a joiner waits for the host's snapshot
    this.buffered = [];
    this.place();
  }

  private end(): void {
    const c = this.sculpt.sculptClient;
    c.share = null;
    c.lockRes = false;
    c.setOwner('local');
    this.sculpt.setRoomPlace(null);
    this.outbox = [];
    this.buffered = [];
    this.waiting = false;
  }

  /** The table's centre, turned the same way for everyone. */
  private place(): void {
    tableFrame.pointIn([0, 0, 0], this.v);
    this.sculpt.setRoomPlace({ x: this.v.x, z: this.v.z, rotY: tableFrame.yawIn(0) });
  }

  private apply(m: RoomMsg): void {
    const seq = Number(m.seq);
    if (seq <= this.lastSeq) return; // already in the snapshot
    if (this.lastSeq && seq !== this.lastSeq + 1 && !room.isHost) {
      // an edit went missing: never go on from a different clay, take the host's (the host's clay is the reference)
      this.stats.resyncs++;
      this.waiting = true;
      this.buffered.push(m);
      room.send('resync');
      return;
    }
    this.lastSeq = seq;
    const e = m.op as Edit, owner = String(m.from), c = this.sculpt.sculptClient;
    if (!e || typeof e !== 'object') return;
    if (e.k === 's' && Array.isArray(e.s)) c.applyRemote(owner, String(e.a), e.s);
    else if (e.k === 'u') c.undoOf(owner);
    else if (e.k === 'r') c.redoOf(owner);
    c.flush();
  }

  private async sendSnapshot(to: string): Promise<void> {
    if (!room.isHost) return;
    const seq = this.lastSeq; // the export below queues behind every edit applied so far
    const data: Record<string, unknown> = {};
    for (const [name, part] of snapshotParts) data[name] = await part.save();
    room.send('snapshot', { to, seq, data });
  }

  private async receiveSnapshot(m: RoomMsg): Promise<void> {
    const data = (m.data ?? {}) as Record<string, unknown>;
    for (const [name, part] of snapshotParts) if (name in data) await part.load(data[name]);
    this.lastSeq = Number(m.seq);
    for (const op of (m.ops as RoomMsg[]) ?? []) this.apply(op);
    const later = this.buffered;
    this.buffered = [];
    this.waiting = false;
    for (const op of later) this.apply(op);
    this.place();
  }

  private async compare(m: RoomMsg): Promise<void> {
    const d = m.data as { seq: number; sum: number } | undefined;
    if (!d || this.waiting || d.seq !== this.lastSeq) return; // only at the same edit
    this.stats.checks++;
    const mine = await this.sculpt.sculptClient.checksum();
    if (mine !== d.sum) {
      this.stats.mismatches++;
      this.stats.resyncs++;
      this.waiting = true; // edits wait for the host's snapshot
      room.send('resync');
    }
  }

  update(): void {
    if (!room.connected) return;
    for (const e of this.outbox) room.send('op', { op: e });
    this.outbox.length = 0;
    const now = performance.now();
    if (room.isHost && now - this.lastCheck > CHECK_MS) {
      this.lastCheck = now;
      const seq = this.lastSeq;
      void this.sculpt.sculptClient.checksum().then((sum) => room.send('check', { data: { seq, sum } }));
    }
  }
}

interface PackedClay {
  res: number;
  size: number;
  lump: SculptSnapshot['lump'];
  actions: SculptSnapshot['actions'];
  data: string;
  labels: string;
  paint: string;
}

async function packClay(s: SculptSnapshot): Promise<PackedClay> {
  return { res: s.res, size: s.size, lump: s.lump, actions: s.actions, data: await packArray(s.data), labels: await packArray(s.labels), paint: await packArray(s.paint) };
}

async function unpackClay(p: PackedClay): Promise<SculptSnapshot> {
  return { res: p.res, size: p.size, lump: p.lump, actions: p.actions, data: await unpackFloats(p.data), labels: await unpackBytes(p.labels), paint: await unpackBytes(p.paint) };
}
