/**
 * The brain's info card: what the AI currently predicts for the focused
 * creation (tap a row for "Why?"), the effect of the last edit, and buttons
 * (Undo edit, Reset brain, Overview). One canvas-textured plane; works with
 * an XR fingertip poke or a mouse click (both resolve to UV regions).
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector2, Vector3 } from '@iwsdk/core';
import type { Prediction } from '../kg/brain.js';

export type CardAction = { kind: 'why'; index: number } | { kind: 'undo' } | { kind: 'reset' } | { kind: 'overview' };

const W = 768, H = 560;
const PLANE_W = 0.24, PLANE_H = 0.175;

interface Region {
  x: number; y: number; w: number; h: number;
  action: CardAction;
}

export class BrainCard {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private regions: Region[] = [];
  private state = {
    title: '', subtitle: '', predictions: [] as Prediction[], status: '', canUndo: false, resetArmed: false, hover: -1, hasFocus: false,
  };
  private dirty = true;
  private wasFront = false;
  private local = new Vector3();
  private lastPress = 0;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(PLANE_W, PLANE_H), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 14;
    this.mesh.userData.card = true;
  }

  set(p: Partial<BrainCard['state']>): void {
    for (const [k, v] of Object.entries(p)) {
      if ((this.state as Record<string, unknown>)[k] !== v) {
        (this.state as Record<string, unknown>)[k] = v;
        this.dirty = true;
      }
    }
  }

  /** Mouse / ray hit: UV -> action. */
  actionAtUv(uv: Vector2): CardAction | null {
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.action ?? null;
  }

  /** XR fingertip: press when it crosses the card plane from the front. */
  poke(tip: Vector3 | null, now: number): CardAction | null {
    if (!tip || !this.mesh.visible) {
      this.wasFront = false;
      this.set({ hover: -1 });
      return null;
    }
    this.local.copy(tip);
    this.mesh.worldToLocal(this.local);
    const inside = Math.abs(this.local.x) < PLANE_W / 2 && Math.abs(this.local.y) < PLANE_H / 2;
    const uv = new Vector2(this.local.x / PLANE_W + 0.5, this.local.y / PLANE_H + 0.5);
    const near = inside && this.local.z < 0.03 && this.local.z > -0.02;
    const act = near ? this.actionAtUv(uv) : null;
    this.set({ hover: act ? this.regions.findIndex((r) => r.action === act) : -1 });
    const front = this.local.z > 0.006;
    let pressed: CardAction | null = null;
    if (inside && this.wasFront && !front && this.local.z > -0.02 && act && now - this.lastPress > 400) {
      this.lastPress = now;
      pressed = act;
    }
    this.wasFront = inside ? front : true;
    return pressed;
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const s = this.state;
    const ctx = this.canvas.getContext('2d')!;
    this.regions = [];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14,16,20,0.86)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 36);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.title || 'The brain', 32, 48, W - 64);
    ctx.fillStyle = 'rgba(244,241,236,0.65)';
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillText(s.subtitle, 32, 90, W - 64);

    const rows = s.predictions.slice(0, 4);
    let y = 128;
    if (!s.hasFocus) {
      ctx.fillStyle = 'rgba(244,241,236,0.8)';
      ctx.font = '500 28px system-ui, sans-serif';
      ctx.fillText('Bring something to life to see what I predict.', 32, y + 30, W - 64);
      ctx.fillText('Pull an edge to cut a belief; drag node to node to add one.', 32, y + 72, W - 64);
    }
    rows.forEach((p, i) => {
      const r: Region = { x: 20, y, w: W - 40, h: 72, action: { kind: 'why', index: i } };
      this.regions.push(r);
      ctx.fillStyle = s.hover === this.regions.length - 1 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 8, 18);
      ctx.fill();
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 30px system-ui, sans-serif';
      ctx.fillText(p.label, 40, y + 32, 360);
      // confidence bar
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(420, y + 24, 200, 16);
      ctx.fillStyle = p.confidence > 0.6 ? '#5fbf72' : p.confidence > 0.3 ? '#f0b429' : '#8fa3b8';
      ctx.fillRect(420, y + 24, 200 * p.confidence, 16);
      ctx.fillStyle = 'rgba(244,241,236,0.8)';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(`${Math.round(p.confidence * 100)}%  Why?`, 632, y + 32);
      y += 72;
    });

    if (s.status) {
      ctx.fillStyle = '#f0b429';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(s.status, 32, H - 118, W - 64);
    }
    const buttons: [string, CardAction, boolean][] = [
      ['↶ Undo edit', { kind: 'undo' }, s.canUndo],
      [s.resetArmed ? 'Tap again: reset' : 'Reset brain', { kind: 'reset' }, true],
      ['Overview', { kind: 'overview' }, true],
    ];
    const bw = (W - 40 - 2 * 16) / 3;
    buttons.forEach(([label, action, enabled], i) => {
      const r: Region = { x: 20 + i * (bw + 16), y: H - 84, w: bw, h: 64, action };
      if (enabled) this.regions.push(r);
      const hov = enabled && s.hover === this.regions.length - 1;
      ctx.fillStyle = !enabled ? 'rgba(255,255,255,0.04)' : hov ? 'rgba(255,255,255,0.24)' : action.kind === 'reset' && s.resetArmed ? '#d9534f' : 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.fillStyle = enabled ? '#f4f1ec' : 'rgba(244,241,236,0.35)';
      ctx.font = '600 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2, r.w - 16);
      ctx.textAlign = 'left';
    });
    this.tex.needsUpdate = true;
  }
}
