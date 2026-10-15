/**
 * The helper character (Update 2, Step 4): a small clay blob made with ClayMind's own
 * clay (the sculpting SDF grid and mesher, painted eyes), sitting at the side of the
 * table, clear of the hands and the play area. It moves by tweens only: breathes when
 * idle, nods, points at something, hops when a step is done, wobbles while it thinks.
 * It talks in a large speech bubble (voice output optional, off by default; no voice
 * input anywhere). Settings: "Helper character" hides it, "Helper voice" mutes it.
 * If the body cannot be built the bubble still works on its own.
 * Others drive it through the bus: mascot:say, mascot:think, mascot:hop.
 */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, createSystem, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { onSettings, settings } from '../core/settings.js';
import { input } from '../platform/input/input-system.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { ChunkMesher } from '../sculpt/marching-cubes.js';
import { SdfGrid } from '../sculpt/sdf-grid.js';
import { vertexColors } from '../sculpt/clay-view.js';

const CLAY = '#e0925f';
/** Beside the play area: this far to the side of the table spot in front of the player (m). */
const SIDE_XR = 0.3;
const BUBBLE_MIN_MS = 4000;

/** Mesh a grid the way the clay is meshed. */
function meshGrid(g: SdfGrid, color: string): BufferGeometry {
  const mesher = new ChunkMesher(g);
  const pos: Float32Array[] = [], nrm: Float32Array[] = [], lab: Uint8Array[] = [], pnt: Uint8Array[] = [];
  const n = g.chunksPerAxis;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const m = mesher.meshChunk(i, j, k);
        if (!m.positions.length) continue;
        pos.push(m.positions);
        nrm.push(m.normals);
        lab.push(m.labels);
        pnt.push(m.paint);
      }
  const cat = <T extends Float32Array | Uint8Array>(parts: T[], make: (n: number) => T): T => {
    const out = make(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(cat(pos, (l) => new Float32Array(l)), 3));
  geo.setAttribute('normal', new BufferAttribute(cat(nrm, (l) => new Float32Array(l)), 3));
  geo.setAttribute('color', new BufferAttribute(vertexColors(cat(lab, (l) => new Uint8Array(l)), cat(pnt, (l) => new Uint8Array(l)), [new Color(color)]), 3));
  return geo;
}

/** The blob: a soft pear of clay with a little top bump, painted eyes and cheeks. Faces +z. */
function buildBody(): { body: Mesh; arm: Mesh } {
  const g = new SdfGrid(38, 0.11);
  g.fillSphere(0, -0.012, 0, 0.034);
  g.brush('add', 0, 0.012, 0, 0.026);
  g.brush('add', 0, 0.036, -0.004, 0.009); // the top bump
  g.brush('smooth', 0, 0.01, 0, 0.03);
  for (const x of [-0.013, 0.013]) {
    g.paintBrush(x, 0.016, 0.026, 0.0062, 0x2b2420);
    g.paintBrush(x + 0.002, 0.0185, 0.031, 0.0022, 0xffffff); // a glint
    g.paintBrush(x * 1.75, 0.0, 0.026, 0.006, 0xf08a8a); // cheeks
  }
  g.paintBrush(0, 0.004, 0.032, 0.004, 0x6b3b2a); // a small mouth
  const mat = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0 });
  const body = new Mesh(meshGrid(g, CLAY), mat);
  // a little arm nub (a clay capsule), shown when it points
  const a = new SdfGrid(24, 0.06);
  a.fillSphere(0, 0, 0.004, 0.0075);
  a.brush('add', 0, 0, 0.004, 0.0075, 0, 0, 0.018);
  const arm = new Mesh(meshGrid(a, CLAY), mat);
  arm.visible = false;
  return { body, arm };
}

function bubbleTexture(): { canvas: HTMLCanvasElement; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 400;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return { canvas, tex };
}

type Tween = { kind: 'nod' | 'hop'; t: number; dur: number };

export class MascotSystem extends createSystem({}) {
  private root = new Group();
  private blob = new Group();
  private arm: Mesh | null = null;
  private bubble!: Sprite;
  private canvas!: HTMLCanvasElement;
  private tex!: CanvasTexture;
  private text = '';
  private bubbleUntil = 0;
  private thinking = 0;
  private tweens: Tween[] = [];
  private pointAt: Vector3 | null = null;
  private pointUntil = 0;
  private t = 0;
  private xz = [0, 0];
  private v = new Vector3();
  private eye = new Vector3();
  private want = new Vector3();
  private placed = false;
  private narrow = false;

  init(): void {
    try {
      const { body, arm } = buildBody();
      body.raycast = () => {}; // never in the way of a ray or a grab
      arm.raycast = () => {};
      this.blob.add(body);
      body.position.y = 0.025; // its bottom on the table
      arm.position.set(0.03, 0.026, 0);
      this.blob.add(arm);
      this.arm = arm;
    } catch (e) {
      console.warn('[mascot] body not built, the bubble works alone', e);
    }
    this.root.add(this.blob);
    const b = bubbleTexture();
    this.canvas = b.canvas;
    this.tex = b.tex;
    this.bubble = new Sprite(new SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.bubble.renderOrder = 27;
    this.bubble.visible = false;
    this.bubble.raycast = () => {};
    this.root.add(this.bubble);
    this.world.createTransformEntity(this.root);
    this.applySettings();
    this.cleanupFuncs.push(
      onSettings(() => this.applySettings()),
      bus.on('mascot:say', (e) => this.say(e.text, e.point ?? null)),
      bus.on('mascot:think', (e) => {
        this.thinking = Math.max(0, this.thinking + (e.on ? 1 : -1));
        if (e.on && e.text) this.show(e.text, false);
        else if (!e.on && this.bubbleUntil === Infinity) this.bubbleUntil = performance.now() + 600;
      }),
      bus.on('mascot:hop', () => this.tweens.push({ kind: 'hop', t: 0, dur: 0.5 }, { kind: 'hop', t: -0.55, dur: 0.45 })),
    );
  }

  private applySettings(): void {
    this.root.visible = settings.helper;
    if (!settings.helperVoice && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  /** Speak (bubble, and voice when on), nod, and point at `point` (world) if given. */
  say(text: string, point: number[] | null): void {
    if (!text) return;
    this.show(text, true);
    this.tweens.push({ kind: 'nod', t: 0, dur: 0.6 });
    if (point) {
      this.pointAt = new Vector3().fromArray(point);
      this.pointUntil = performance.now() + 3000;
    }
    if (settings.helper && settings.helperVoice && settings.sound && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      speechSynthesis.speak(u);
    }
  }

  private show(text: string, timed: boolean): void {
    this.text = text;
    const words = text.split(/\s+/).length;
    this.bubbleUntil = timed ? performance.now() + Math.max(BUBBLE_MIN_MS, words * 400) : Infinity;
    this.paintBubble();
    this.bubble.visible = true;
  }

  private paintBubble(): void {
    const c = this.canvas, ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const hc = settings.highContrast;
    ctx.fillStyle = hc ? '#000' : 'rgba(250,247,240,0.96)';
    ctx.strokeStyle = hc ? '#fff' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = hc ? 6 : 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, c.width - 16, c.height - 64, 48);
    ctx.moveTo(c.width / 2 - 30, c.height - 57);
    ctx.lineTo(c.width / 2, c.height - 10);
    ctx.lineTo(c.width / 2 + 30, c.height - 57);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hc ? '#fff' : '#2b2420';
    ctx.font = '600 58px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // wrap into at most 4 lines
    const lines: string[] = [];
    let line = '';
    for (const w of this.text.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > c.width - 100 && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length > 4) {
      lines.length = 4;
      lines[3] = `${lines[3].replace(/\s+\S*$/, '')}…`;
    }
    const top = (c.height - 56) / 2 - ((lines.length - 1) * 70) / 2;
    lines.forEach((l, i) => ctx.fillText(l, 50, top + i * 70, c.width - 100));
    this.tex.needsUpdate = true;
  }

  /** Beside the play area, on the table, facing the player. */
  private place(dt: number): void {
    const eye = this.world.camera.getWorldPosition(this.eye);
    nearestSurfacePoint(eye.x, eye.z, 0.24, this.xz);
    const fx = eye.x - this.xz[0], fz = eye.z - this.xz[1], fl = Math.hypot(fx, fz) || 1;
    // to the player's right (left for left-handed players: their free side is the other one)
    const side = settings.leftHanded ? -1 : 1;
    // a narrow browser window: further back and nearer the middle so it stays in view
    this.narrow = !input.xr && (this.world.camera as PerspectiveCamera).aspect < 1.4;
    const SIDE = this.narrow ? 0.24 : SIDE_XR, BACK = this.narrow ? 0.2 : 0.1;
    // (right of a player looking along -f is (f.z, -f.x)); a little further back than the play area's centre
    let x = this.xz[0] + (fz / fl) * SIDE * side - (fx / fl) * BACK, z = this.xz[1] - (fx / fl) * SIDE * side - (fz / fl) * BACK;
    // keep it on the table
    const c = Math.cos(surface.yaw), s = Math.sin(surface.yaw);
    let lx = (x - surface.centerX) * c - (z - surface.centerZ) * s, lz = (x - surface.centerX) * s + (z - surface.centerZ) * c;
    lx = Math.max(-surface.halfW + 0.05, Math.min(surface.halfW - 0.05, lx));
    lz = Math.max(-surface.halfD + 0.05, Math.min(surface.halfD - 0.05, lz));
    x = surface.centerX + lx * c + lz * s;
    z = surface.centerZ - lx * s + lz * c;
    this.want.set(x, surface.topY, z);
    if (!this.placed) this.root.position.copy(this.want);
    else this.root.position.lerp(this.want, Math.min(1, dt * 3));
    this.placed = true;
    // face the player, or what it points at
    const look = this.pointAt && performance.now() < this.pointUntil ? this.pointAt : eye;
    const yaw = Math.atan2(look.x - this.root.position.x, look.z - this.root.position.z);
    let d = yaw - this.blob.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.blob.rotation.y += d * Math.min(1, dt * 6);
  }

  update(delta: number): void {
    if (!settings.helper) return;
    const dt = Math.min(delta, 0.1), now = performance.now();
    this.t += dt;
    this.place(dt);
    const calm = settings.reducedMotion;
    // idle breathe
    const br = calm ? 0 : Math.sin(this.t * 2.1) * 0.03;
    let y = 0, rx = 0, sq = 0;
    for (const tw of this.tweens) {
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.dur);
      if (tw.kind === 'nod') rx += Math.sin(k * Math.PI * 2) * 0.22;
      else {
        y += Math.sin(k * Math.PI) * (calm ? 0.01 : 0.04);
        sq += k > 0.85 ? (1 - k) * 0.6 : 0;
      }
    }
    this.tweens = this.tweens.filter((tw) => tw.t < tw.dur);
    this.blob.position.y = y;
    this.blob.rotation.x = rx;
    this.blob.rotation.z = this.thinking && !calm ? Math.sin(this.t * 9) * 0.12 : 0;
    this.blob.scale.set(1 - br / 2 + sq, 1 + br - sq, 1 - br / 2 + sq);
    if (this.arm) this.arm.visible = !!this.pointAt && now < this.pointUntil;
    if (this.pointAt && now >= this.pointUntil) this.pointAt = null;
    // bubble above it, a readable size
    const xr = input.xr;
    this.bubble.scale.set(xr ? 0.2 : 0.21, xr ? 0.078 : 0.082, 1);
    this.bubble.position.set(0, 0.13 + y, 0);
    if (this.narrow) this.bubble.position.x = (this.xz[0] - this.root.position.x) * 0.5, this.bubble.position.z = (this.xz[1] - this.root.position.z) * 0.5;
    if (this.bubble.visible && now > this.bubbleUntil && !this.thinking) this.bubble.visible = false;
  }
}
