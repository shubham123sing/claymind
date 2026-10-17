/**
 * Living objects in a room (V5): what a player brings to life appears for everyone, where they
 * made it. Holding one sends its pose (about 15 a second) and the others see it move and cannot
 * take it; letting go sends the throw, and every table runs the same throw in its own physics;
 * once it rests, the thrower sends its final pose so all tables agree again. Deleting it
 * removes it for everyone; a late joiner gets them all with the host's snapshot.
 * Play Kit games keep their own host-run sync (shared-play.ts); objects made before joining a
 * room stay on their own table.
 */
import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import type { SavedCreation } from '../storage/library.js';
import { packDeep, unpackDeep } from './codec.js';
import { room, type RoomMsg } from './room-client.js';
import { snapshotParts } from './shared-clay.js';
import { tableFrame } from './table-frame.js';

const SEND_MS = 66;
/** a remote hold with no news for this long (network, a closed tab): the object falls */
const QUIET_MS = 3000;
const REST_MS = 1000;
/** the clay comes back 1.4 s after Bring to life (and grows for 0.6 s) */
const LIFE_WAIT_MS = 2500;

type BodyMsg =
  | { k: 'life'; id: string; d: unknown; p: number[]; q: number[] }
  | { k: 'hold' | 'rest'; id: string; p: number[]; q: number[] }
  | { k: 'release'; id: string; p: number[]; q: number[]; v: number[] }
  | { k: 'gone'; id: string };

export class SharedBodiesSystem extends createSystem({}) {
  /** creation ids shared with the room */
  readonly shared = new Set<string>();
  /** ids my hand holds -> when its pose was last sent */
  private held = new Map<string, number>();
  /** ids another player holds -> when their pose last came */
  private remote = new Map<string, number>();
  /** ids I made or threw -> where they were and since when: the resting pose is sent once they settle */
  private settling = new Map<string, { p: Vector3; since: number }>();
  private P = new Vector3();
  private Q = new Quaternion();
  private V = new Vector3();

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  init(): void {
    snapshotParts.set('bodies', { save: () => this.snapshot(), load: (d) => this.loadSnapshot(d) });
    // the host's Play Kit puts shared creations away for a game and back after it: back for everyone
    const kit = this.world.getSystem(PlayKitSystem);
    if (kit) {
      kit.roomShared = (id) => room.connected && this.shared.has(id);
      kit.roomRestored = (id) => {
        if (room.connected) void this.announce(id);
      };
    }
    this.cleanupFuncs.push(
      bus.on('creation:baked', (e) => {
        if (room.connected) setTimeout(() => void this.announce(e.creation.id), 0);
      }),
      bus.on('creation:removed', (e) => {
        if (room.connected && this.shared.delete(e.creationId)) room.send('body', { data: { k: 'gone', id: e.creationId } });
      }),
      bus.on('body:released', (e) => this.released(e.id, e.v)),
      bus.on('room:left', () => {
        for (const id of this.remote.keys()) this.objects.setToyLocked(id, false);
        this.shared.clear();
        this.held.clear();
        this.remote.clear();
        this.settling.clear();
      }),
      room.on('body', (m) => void this.onBody(m)),
    );
  }

  private send(d: BodyMsg): void {
    room.send('body', { data: d });
  }

  private pose(id: string): { p: number[]; q: number[] } | null {
    const o = this.objects.poseOf(id);
    return o ? { p: tableFrame.pointOut(o.p), q: tableFrame.quatOut(o.q) } : null;
  }

  /** Something I brought to life: to the room (once its material is built in). */
  private async announce(id: string, tries = 0): Promise<void> {
    const s = this.objects.serialize(id);
    if (!s) {
      if (tries < 15) setTimeout(() => void this.announce(id, tries + 1), 300);
      return;
    }
    const pose = this.pose(id);
    if (!pose || !room.connected) return;
    this.shared.add(id);
    this.send({ k: 'life', id, d: await packDeep({ ...s, thumb: '' }), ...pose });
    this.settle(id, LIFE_WAIT_MS); // the fresh lump of clay nudges it aside: its resting pose follows
  }

  private async onBody(m: RoomMsg): Promise<void> {
    const d = m.data as BodyMsg | undefined;
    if (!d || typeof d.id !== 'string') return;
    const o = this.objects, at = () => tableFrame.pointIn((d as { p: number[] }).p, this.P), turn = () => tableFrame.quatIn((d as { q: number[] }).q, this.Q);
    switch (d.k) {
      case 'life': {
        const s = (await unpackDeep(d.d)) as SavedCreation;
        if (!s?.parts?.length || s.id !== d.id || !Array.isArray(d.p) || !Array.isArray(d.q)) return;
        if (o.spawnShared(s, at(), turn())) {
          this.shared.add(d.id);
          const who = room.players.find((p) => p.id === m.from)?.name ?? 'Someone';
          bus.emit('ui:toast', { text: `${who} brought "${s.creation.name.slice(0, 40)}" to life` });
        }
        return;
      }
      case 'hold':
        if (!this.shared.has(d.id) || this.held.has(d.id)) return; // both hands on it: each keeps theirs; the last throw wins
        if (!this.remote.has(d.id)) {
          o.demoHold(d.id);
          o.setToyLocked(d.id, true);
        }
        this.remote.set(d.id, performance.now());
        o.demoPose(d.id, at(), turn());
        return;
      case 'release':
        if (!this.shared.has(d.id)) return;
        this.remote.delete(d.id);
        o.setToyLocked(d.id, false);
        o.demoPose(d.id, at(), turn());
        o.demoRelease(d.id, tableFrame.dirIn(d.v, this.V).toArray() as [number, number, number]);
        return;
      case 'rest':
        if (this.shared.has(d.id) && !this.held.has(d.id) && !this.remote.has(d.id)) o.snapShared(d.id, at(), turn());
        return;
      case 'gone':
        if (this.shared.delete(d.id)) o.removeCreation(d.id);
        return;
    }
  }

  private released(id: string, v: number[]): void {
    if (!this.held.delete(id) || !room.connected) return;
    const pose = this.pose(id);
    if (!pose) return;
    this.send({ k: 'release', id, ...pose, v: tableFrame.dirOut({ x: v[0], y: v[1], z: v[2] }) });
    this.settle(id);
  }

  private settle(id: string, wait = 0): void {
    const o = this.objects.poseOf(id);
    if (o) this.settling.set(id, { p: o.p.clone(), since: performance.now() + wait });
  }

  private async snapshot(): Promise<unknown> {
    const out: { id: string; d: unknown; p: number[]; q: number[] }[] = [];
    for (const id of this.shared) {
      const s = this.objects.serialize(id), pose = this.pose(id);
      if (s && pose) out.push({ id, d: await packDeep({ ...s, thumb: '' }), ...pose });
    }
    return out;
  }

  private async loadSnapshot(data: unknown): Promise<void> {
    if (!Array.isArray(data)) return;
    for (const b of data as { id: string; d: unknown; p: number[]; q: number[] }[]) {
      const s = (await unpackDeep(b.d)) as SavedCreation;
      if (s?.id === b.id && this.objects.spawnShared(s, tableFrame.pointIn(b.p, this.P), tableFrame.quatIn(b.q, this.Q))) this.shared.add(b.id);
    }
  }

  update(): void {
    if (!room.connected || !this.shared.size) return;
    const now = performance.now(), o = this.objects;
    for (const id of this.shared) {
      const quiet = this.remote.get(id);
      if (quiet !== undefined) {
        if (now - quiet > QUIET_MS) {
          this.remote.delete(id);
          o.setToyLocked(id, false);
          o.demoRelease(id, [0, -0.01, 0]);
        }
        continue;
      }
      if (o.isHeld(id)) {
        this.settling.delete(id);
        if (now - (this.held.get(id) ?? 0) < SEND_MS) continue;
        const pose = this.pose(id);
        if (pose) this.send({ k: 'hold', id, ...pose });
        this.held.set(id, now);
      } else {
        // resting: has not moved 2 mm for a second
        const st = this.settling.get(id), now3 = o.poseOf(id);
        if (!st || !now3) continue;
        if (now3.p.distanceTo(st.p) > 0.002) {
          st.p.copy(now3.p);
          st.since = now;
        } else if (now - st.since > REST_MS) {
          this.settling.delete(id);
          const pose = this.pose(id);
          if (pose) this.send({ k: 'rest', id, ...pose });
        }
      }
    }
  }
}
