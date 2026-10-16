/**
 * Presence in a room: the other players as a simple head and two hands (original low-poly
 * shapes tinted with their colour) with a name tag, sitting at their seat around the
 * shared table. Head and hands are sent about 15 times a second and shown 120 ms late,
 * interpolated between the last two updates, so movement stays smooth over the network.
 * No voice (hands only): a raised, waving hand shows a wave to everyone, a thumbs-up held for
 * half a second shows a thumbs-up.
 */
import {
  CanvasTexture, createSystem, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { surface } from '../platform/surface/surface-system.js';
import { room, type RoomMsg, type RoomPlayer } from './room-client.js';
import { tableFrame } from './table-frame.js';

const SEND_MS = 66; // ~15 Hz
const DELAY_MS = 120;
const STALE_MS = 3000;

interface HandPose {
  wrist: number[];
  index: number[];
  thumb: number[];
}

interface Pose {
  at: number;
  head: number[];
  headQ: number[];
  hands: (HandPose | null)[];
  wave?: boolean;
  thumbs?: boolean;
}

interface Avatar {
  player: RoomPlayer;
  root: Group;
  head: Mesh;
  hands: { root: Group; palm: Mesh; index: Mesh; thumb: Mesh }[];
  tag: Sprite;
  tex: CanvasTexture;
  poses: Pose[];
  waveUntil: number;
  mat: MeshStandardMaterial;
}

const headGeo = new IcosahedronGeometry(0.09, 1);
const visorGeo = new SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3);
const palmGeo = new SphereGeometry(0.035, 10, 8);
const tipGeo = new SphereGeometry(0.011, 8, 6);

function nameTag(name: string, color: string): { tex: CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  drawTag(canvas, name, color, '');
  return { tex, canvas };
}

function drawTag(canvas: HTMLCanvasElement, name: string, color: string, sign: '' | '👋' | '👍'): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(14,16,20,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 14, 504, 100, 40);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f1ec';
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign ? `${name} ${sign}` : name, 104, 66, 390);
}

export class PresenceSystem extends createSystem({}) {
  private avatars = new Map<string, Avatar>();
  private lastSend = 0;
  private v = new Vector3();
  private v2 = new Vector3();
  private q = new Quaternion();
  private q2 = new Quaternion();
  private surfaceVersion = -1;
  private wristHist: { x: number; t: number }[] = [];
  private waveSentAt = 0;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('room:joined', () => this.reframe()),
      bus.on('room:left', () => this.clear()),
      room.on('players', () => this.syncPlayers()),
      room.on('presence', (m) => this.receive(m)),
    );
  }

  private reframe(): void {
    if (!room.me) return;
    this.world.camera.getWorldPosition(this.v);
    tableFrame.set(this.v, room.me.color);
    this.surfaceVersion = surface.version;
    this.syncPlayers();
  }

  private clear(): void {
    for (const a of this.avatars.values()) this.dispose(a);
    this.avatars.clear();
  }

  private syncPlayers(): void {
    const ids = new Set(room.players.map((p) => p.id));
    for (const [id, a] of this.avatars) if (!ids.has(id)) {
      this.dispose(a);
      this.avatars.delete(id);
    }
    for (const p of room.players) if (p.id !== room.me?.id && !this.avatars.has(p.id)) this.avatars.set(p.id, this.make(p));
  }

  private make(player: RoomPlayer): Avatar {
    const mat = new MeshStandardMaterial({ color: player.color, roughness: 0.6, metalness: 0, flatShading: true });
    const root = new Group();
    const head = new Mesh(headGeo, mat);
    const visor = new Mesh(visorGeo, new MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.3 }));
    visor.rotation.x = Math.PI / 2;
    visor.position.z = -0.06;
    head.add(visor);
    root.add(head);
    const hands = [0, 1].map(() => {
      const g = new Group();
      const palm = new Mesh(palmGeo, mat);
      palm.scale.set(1, 0.45, 1.2);
      const index = new Mesh(tipGeo, mat), thumb = new Mesh(tipGeo, mat);
      g.add(palm, index, thumb);
      g.visible = false;
      root.add(g);
      return { root: g, palm, index, thumb };
    });
    const { tex } = nameTag(player.name, player.color);
    const tag = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    tag.scale.set(0.24, 0.06, 1);
    tag.renderOrder = 20;
    root.add(tag);
    root.visible = false;
    for (const o of [head, visor, ...hands.flatMap((h) => [h.palm, h.index, h.thumb]), tag]) o.raycast = () => {}; // never in the way of hands or rays
    this.world.createTransformEntity(root);
    return { player, root, head, hands, tag, tex, poses: [], waveUntil: 0, mat };
  }

  private dispose(a: Avatar): void {
    a.root.removeFromParent();
    a.mat.dispose();
    a.tex.dispose();
  }

  private receive(m: RoomMsg): void {
    const a = this.avatars.get(String(m.from));
    const d = m.data as Pose | undefined;
    if (!a || !d || !Array.isArray(d.head) || d.head.length !== 3) return;
    a.poses.push({ ...d, at: performance.now() });
    if (a.poses.length > 4) a.poses.shift();
    if ((d.wave || d.thumbs) && a.waveUntil < performance.now()) {
      a.waveUntil = performance.now() + 2500;
      drawTag(a.tex.image as HTMLCanvasElement, a.player.name, a.player.color, d.thumbs ? '👍' : '👋');
      a.tex.needsUpdate = true;
    }
  }

  // ---------- sending ----------

  private send(now: number): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.v);
    cam.getWorldQuaternion(this.q);
    const hand = (side: 'left' | 'right'): HandPose | null => {
      const h = input.hands[side];
      if (!input.xr || !h.tracked) return null;
      const w = h.palmCenter, i = h.indexTip, t = h.pinchPoint;
      return {
        wrist: tableFrame.pointOut({ x: w[0], y: w[1], z: w[2] }),
        index: tableFrame.pointOut({ x: i[0], y: i[1], z: i[2] }),
        thumb: tableFrame.pointOut({ x: t[0], y: t[1], z: t[2] }),
      };
    };
    const data: Pose = { at: 0, head: tableFrame.pointOut(this.v), headQ: tableFrame.quatOut(this.q), hands: [hand('left'), hand('right')] };
    if (this.waving(now)) data.wave = true;
    if (this.thumbsUp(now)) data.thumbs = true;
    room.send('presence', { data });
  }

  /** A thumbs-up held for half a second (either hand). */
  private thumbsUp(now: number): boolean {
    const up = input.xr && (input.hands.left.thumbsUp || input.hands.right.thumbsUp);
    if (!up) this.thumbsSince = 0;
    else if (!this.thumbsSince) this.thumbsSince = now;
    return !!up && now - this.thumbsSince >= 500;
  }
  private thumbsSince = 0;

  /** A hand raised above the head and moved side to side twice within a second. */
  private waving(now: number): boolean {
    const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
    if (!input.xr || !h.tracked || h.palmCenter[1] < this.v.y - 0.05) {
      this.wristHist.length = 0;
      return false;
    }
    this.wristHist.push({ x: h.palmCenter[0], t: now });
    while (this.wristHist.length && now - this.wristHist[0].t > 1000) this.wristHist.shift();
    let turns = 0, dir = 0;
    for (let i = 1; i < this.wristHist.length; i++) {
      const d = Math.sign(this.wristHist[i].x - this.wristHist[i - 1].x);
      if (d && d !== dir) {
        if (dir) turns++;
        dir = d;
      }
    }
    if (turns >= 3 && now - this.waveSentAt > 3000) {
      this.waveSentAt = now;
      return true;
    }
    return false;
  }

  // ---------- showing ----------

  private show(a: Avatar, now: number): void {
    const t = now - DELAY_MS, ps = a.poses;
    if (!ps.length || now - ps[ps.length - 1].at > STALE_MS) {
      a.root.visible = false;
      return;
    }
    a.root.visible = true;
    // the two updates around t (or the latest)
    let p0 = ps[0], p1 = ps[ps.length - 1];
    for (let i = 0; i < ps.length - 1; i++) if (ps[i].at <= t && ps[i + 1].at >= t) (p0 = ps[i]), (p1 = ps[i + 1]);
    const k = p1.at > p0.at ? Math.min(1, Math.max(0, (t - p0.at) / (p1.at - p0.at))) : 1;
    const lerp = (a0: number[], b0: number[], out: Vector3) => tableFrame.pointIn(a0, out).lerp(tableFrame.pointIn(b0, this.v2), k);
    lerp(p0.head, p1.head, a.head.position);
    a.head.quaternion.slerpQuaternions(tableFrame.quatIn(p0.headQ, this.q), tableFrame.quatIn(p1.headQ, this.q2), k);
    a.tag.position.copy(a.head.position).setY(a.head.position.y + 0.17);
    a.hands.forEach((h, i) => {
      const h0 = p0.hands[i], h1 = p1.hands[i];
      h.root.visible = !!(h0 && h1);
      if (!h0 || !h1) return;
      lerp(h0.wrist, h1.wrist, h.palm.position);
      lerp(h0.index, h1.index, h.index.position);
      lerp(h0.thumb, h1.thumb, h.thumb.position);
    });
    if (a.waveUntil && now > a.waveUntil) {
      a.waveUntil = 0;
      drawTag(a.tex.image as HTMLCanvasElement, a.player.name, a.player.color, '');
      a.tex.needsUpdate = true;
    }
  }

  update(): void {
    if (!room.connected) return;
    const now = performance.now();
    if (surface.version !== this.surfaceVersion) this.reframe();
    if (now - this.lastSend >= SEND_MS) {
      this.lastSend = now;
      this.send(now);
    }
    for (const a of this.avatars.values()) this.show(a, now);
  }
}
