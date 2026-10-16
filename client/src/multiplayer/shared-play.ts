/**
 * Playing together (Update 3, Step C): the Play Kit games in a room, host-authoritative.
 * - Only the host starts games; a game is set to the room's players (turns, names on the
 *   scoreboard; one-turn games like Knock-down give every player the same set-up).
 * - The host sends the game (its pieces; a player's own toys travel with it) and then,
 *   about 15 times a second, the moving pieces' poses, the scoreboard, whose turn it is and
 *   who holds what. The others show the same pieces, interpolated 100 ms late.
 * - Another player takes their turn with their own hands: while they hold a piece, its pose
 *   goes to the host (the piece is locked to them); letting go sends the throw's velocity
 *   and the host's physics carries on. Pieces are locked when it is not your turn.
 * - If the host leaves, the game ends cleanly (the room goes on with a new host).
 */
import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { validateSpec, type GameSpec } from '../playkit/game-spec.js';
import type { KitItem } from '../playkit/kit-store.js';
import { PlayKitSystem, type RoomPiece } from '../playkit/playkit-system.js';
import { packDeep, unpackDeep } from './codec.js';
import { room, type RoomMsg } from './room-client.js';
import { snapshotParts } from './shared-clay.js';
import { tableFrame } from './table-frame.js';

const STATE_MS = 66;
const HOLD_MS = 33;
const DELAY_MS = 100;
const LOCK_MS = 1500;

interface Sample {
  t: number;
  p: number[];
  q: number[];
}

/** A game for the room's players (more players, turns; same set-up each turn when it had one turn). */
export function adaptForRoom(spec: GameSpec, players: number): GameSpec {
  const n = Math.min(4, players);
  if (n <= 1 || spec.shotsPerTurn <= 0 || spec.players >= n) return spec;
  const g: GameSpec = JSON.parse(JSON.stringify(spec));
  g.players = n;
  if (g.maxTurns === 1) g.resetEachTurn = true;
  return validateSpec(g).length ? spec : g;
}

export class SharedPlaySystem extends createSystem({}) {
  private samples = new Map<string, Sample[]>();
  private held = new Set<string>();
  private locks = new Map<string, { player: string; until: number }>();
  private turn: string | null = null;
  private lastState = 0;
  private lastHold = 0;
  private P = new Vector3();
  private Q = new Quaternion();
  private Q2 = new Quaternion();
  private P2 = new Vector3();

  private get kit() {
    return this.world.getSystem(PlayKitSystem)!;
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  init(): void {
    const kit = this.kit;
    kit.roomAdapt = (spec) => (room.connected && room.isHost ? adaptForRoom(spec, room.players.length) : spec);
    kit.roomCanStart = () => (room.connected && !room.isHost ? 'In a room the host starts the games' : null);
    kit.roomNames = () => (room.connected ? room.players.map((p) => p.name) : []);
    kit.roomShare = (item) => {
      if (!room.connected) return false;
      void packDeep(item).then((data) => room.send('kit', { data }));
      return true;
    };
    snapshotParts.set('game', {
      save: () => (room.isHost && kit.hasGame && !kit.mirror ? this.describe() : null),
      load: (data) => (data ? this.mirrorGame(data as GameMsg) : undefined),
    });
    this.cleanupFuncs.push(
      bus.on('playkit:game', (e) => void this.announce(e.kind)),
      bus.on('toy:released', (e) => this.released(e.toyId, e.v)),
      bus.on('room:left', () => this.leaveGame('')),
      room.on('host', () => {
        if (this.kit.mirror) this.leaveGame('The host left: the game ended');
      }),
      room.on('game', (m) => void this.onGame(m)),
      room.on('state', (m) => this.onState(m)),
      room.on('input', (m) => this.onInput(m)),
      room.on('kit', (m) => void this.received(m)),
    );
  }

  // ---------- host ----------

  private async describe(): Promise<GameMsg | null> {
    const d = this.kit.roomDescribe();
    if (!d) return null;
    const origin = tableFrame.pointOut({ x: d.frame.origin[0], y: d.frame.origin[1], z: d.frame.origin[2] });
    return { k: 'start', d: (await packDeep({ spec: d.spec, setName: d.setName, pieces: d.pieces })) as GameMsg['d'], origin, yaw: tableFrame.yawOut(d.frame.yaw) };
  }

  private async announce(kind: 'start' | 'end' | 'reset'): Promise<void> {
    if (!room.connected || !room.isHost || this.kit.mirror) return;
    this.locks.clear();
    if (kind === 'start') {
      const g = await this.describe();
      if (g) room.send('game', { data: g });
    } else room.send('game', { data: { k: kind } });
  }

  private turnPlayer(): string | null {
    const h = this.kit.roomHud();
    if (!h || !this.kit.hasGame) return null;
    const spec = this.kit.roomDescribe()?.spec;
    return spec && spec.players > 1 ? room.players[h.player]?.id ?? null : null;
  }

  private onInput(m: RoomMsg): void {
    if (!room.isHost || !this.kit.hasGame || this.kit.mirror) return;
    const from = String(m.from), d = m.data as { k: string; id: string; p: number[]; q: number[]; v?: number[] };
    if (!d || typeof d.id !== 'string' || !Array.isArray(d.p) || !Array.isArray(d.q)) return;
    const turn = this.turnPlayer();
    if (turn && turn !== from) return; // not their turn
    const piece = this.kit.roomPieces.find((p) => p.toyId === d.id);
    if (!piece || piece.fixed) return;
    const now = performance.now(), lock = this.locks.get(d.id);
    if (lock && lock.player !== from && lock.until > now) return; // someone else has it
    if (this.objects.isHeld(d.id)) return; // the host's own hand has it
    this.objects.demoHold(d.id);
    this.kit.roomPoseIn(d.p, d.q, this.P, this.Q);
    this.objects.demoPose(d.id, this.P, this.Q);
    if (d.k === 'hold') this.locks.set(d.id, { player: from, until: now + LOCK_MS });
    else if (d.k === 'release') {
      this.objects.demoRelease(d.id, (this.kit.roomDir(d.v ?? [0, 0, 0], true) as [number, number, number]));
      this.locks.delete(d.id);
    }
  }

  private hostTick(now: number): void {
    // a hold that went quiet (network, a closed tab): let the piece fall
    for (const [id, l] of this.locks) if (l.until < now) {
      this.objects.demoRelease(id, [0, 0, 0]);
      this.locks.delete(id);
    }
    if (now - this.lastState < STATE_MS || !this.kit.hasGame || room.players.length < 2) return;
    this.lastState = now;
    const turn = this.turnPlayer();
    // the host's own hands follow the same turns and locks
    const mine = !turn || turn === room.me?.id;
    this.kit.roomLock(null, !mine);
    for (const [id] of this.locks) this.kit.roomLock(id, true);
    const locks: Record<string, string> = {};
    for (const [id, l] of this.locks) locks[id] = l.player;
    room.send('state', { data: { poses: this.kit.roomPoses(), hud: this.kit.roomHud(), turn, locks } });
  }

  // ---------- the other players ----------

  private async onGame(m: RoomMsg): Promise<void> {
    if (room.isHost) return;
    const g = m.data as GameMsg;
    if (g?.k === 'start') await this.mirrorGame(g);
    else if (g?.k === 'end') this.leaveGame('The host ended the game');
    else if ((g as { k: string })?.k === 'preview') {
      const host = room.players.find((p) => p.id === room.host)?.name ?? 'The host';
      bus.emit('ui:toast', { text: `${host} is looking at "${String((g as { name?: string }).name ?? 'a game').slice(0, 40)}"` });
    }
  }

  private async mirrorGame(g: GameMsg): Promise<void> {
    const d = (await unpackDeep(g.d)) as { spec: GameSpec; setName: string; pieces: RoomPiece[] };
    if (validateSpec(d.spec).length) return; // never run a game that does not check out
    this.samples.clear();
    this.held.clear();
    tableFrame.pointIn(g.origin, this.P);
    this.kit.roomMirror(d, this.P, tableFrame.yawIn(g.yaw));
    for (const p of this.kit.roomPieces) if (!p.fixed) this.objects.demoHold(p.toyId);
    this.kit.roomLock(null, true); // until the host says whose turn it is
  }

  /** A toy someone shared: a copy goes into my Play Kit. */
  private async received(m: RoomMsg): Promise<void> {
    const item = (await unpackDeep(m.data)) as KitItem;
    if (!item?.data?.parts?.length || typeof item.name !== 'string') return;
    this.kit.importKit([item], []);
    const who = room.players.find((p) => p.id === m.from)?.name ?? 'Someone';
    bus.emit('ui:toast', { text: `${who} shared "${item.name.slice(0, 40)}": a copy is in your Play Kit` });
  }

  private leaveGame(why: string): void {
    this.locks.clear();
    this.samples.clear();
    this.held.clear();
    if (this.kit.mirror) {
      this.kit.end();
      if (why) bus.emit('ui:toast', { text: why });
    }
  }

  private onState(m: RoomMsg): void {
    if (room.isHost || !this.kit.mirror) return;
    const d = m.data as { poses: [string, number[], number[]][]; hud: { lines: string[]; message: string; over: boolean } | null; turn: string | null; locks: Record<string, string> };
    if (!d || !Array.isArray(d.poses)) return;
    const now = performance.now();
    for (const [id, p, q] of d.poses) {
      const s = this.samples.get(id) ?? [];
      s.push({ t: now, p, q });
      if (s.length > 4) s.shift();
      this.samples.set(id, s);
    }
    if (d.hud) this.kit.roomSetHud(d.hud);
    this.turn = d.turn;
    const mine = !d.turn || d.turn === room.me?.id;
    this.kit.roomLock(null, !mine);
    for (const [id, who] of Object.entries(d.locks ?? {})) if (who !== room.me?.id) this.kit.roomLock(id, true);
  }

  private released(toyId: string, v?: number[]): void {
    if (!room.connected || room.isHost || !this.kit.mirror || !this.held.has(toyId)) return;
    this.held.delete(toyId);
    const pose = this.kit.roomPoseOut(toyId);
    if (pose) room.send('input', { data: { k: 'release', id: toyId, ...pose, v: this.kit.roomDir(v ?? [0, 0, 0], false) } });
  }

  private mirrorTick(now: number): void {
    const sendHold = now - this.lastHold >= HOLD_MS;
    if (sendHold) this.lastHold = now;
    for (const p of this.kit.roomPieces) {
      if (p.fixed) continue;
      if (this.objects.isHeld(p.toyId)) {
        // my hand has it: its pose goes to the host
        this.held.add(p.toyId);
        if (sendHold) {
          const pose = this.kit.roomPoseOut(p.toyId);
          if (pose) room.send('input', { data: { k: 'hold', id: p.toyId, ...pose } });
        }
        continue;
      }
      const s = this.samples.get(p.toyId);
      if (!s?.length) continue;
      this.objects.demoHold(p.toyId); // back to following after a throw
      const t = now - DELAY_MS;
      let a = s[0], b = s[s.length - 1];
      for (let i = 0; i < s.length - 1; i++) if (s[i].t <= t && s[i + 1].t >= t) (a = s[i]), (b = s[i + 1]);
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      this.kit.roomPoseIn(a.p, a.q, this.P, this.Q);
      this.kit.roomPoseIn(b.p, b.q, this.P2, this.Q2);
      this.P.lerp(this.P2, k);
      this.Q.slerp(this.Q2, k);
      this.objects.demoPose(p.toyId, this.P, this.Q);
    }
  }

  update(): void {
    if (!room.connected) return;
    const now = performance.now();
    if (room.isHost && !this.kit.mirror) this.hostTick(now);
    else if (this.kit.mirror) this.mirrorTick(now);
  }
}

interface GameMsg {
  k: 'start';
  d: unknown;
  origin: number[];
  yaw: number;
}
