/**
 * A world-space panel drawn on a canvas, operable by an XR fingertip poke or a
 * mouse click (both resolve to registered hit regions). Subclasses implement
 * `paint(ctx, add)`, registering buttons with `add(x, y, w, h, id)`.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector2, Vector3 } from '@iwsdk/core';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

export abstract class CanvasPanel {
  readonly mesh: Mesh;
  protected canvas = document.createElement('canvas');
  protected hover: string | null = null;
  private tex: CanvasTexture;
  private regions: Region[] = [];
  private dirty = true;
  private wasFront = false;
  private local = new Vector3();
  private uv = new Vector2();
  private lastPress = 0;

  constructor(readonly px: [number, number], readonly size: [number, number]) {
    this.canvas.width = px[0];
    this.canvas.height = px[1];
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(size[0], size[1]), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 14;
  }

  protected abstract paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void;

  invalidate(): void {
    this.dirty = true;
  }

  /** Redraw if something changed. Call once per frame. */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.px[0], this.px[1]);
    this.regions = [];
    this.paint(ctx, (x, y, w, h, id) => this.regions.push({ x, y, w, h, id }));
    this.tex.needsUpdate = true;
  }

  regionAtUv(uv: Vector2): string | null {
    const x = uv.x * this.px[0], y = (1 - uv.y) * this.px[1];
    return this.regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.id ?? null;
  }

  /** XR: returns the region id pressed this frame by a fingertip crossing the panel. */
  poke(tip: Vector3 | null, now: number): string | null {
    if (!tip || !this.mesh.visible) {
      this.wasFront = false;
      this.setHover(null);
      return null;
    }
    this.local.copy(tip);
    this.mesh.worldToLocal(this.local);
    const inside = Math.abs(this.local.x) < this.size[0] / 2 && Math.abs(this.local.y) < this.size[1] / 2;
    this.uv.set(this.local.x / this.size[0] + 0.5, this.local.y / this.size[1] + 0.5);
    const near = inside && this.local.z < 0.03 && this.local.z > -0.02;
    const id = near ? this.regionAtUv(this.uv) : null;
    this.setHover(id);
    const front = this.local.z > 0.006;
    let pressed: string | null = null;
    if (inside && this.wasFront && !front && this.local.z > -0.02 && id && now - this.lastPress > 400) {
      this.lastPress = now;
      pressed = id;
    }
    this.wasFront = inside ? front : true;
    return pressed;
  }

  setHover(id: string | null): void {
    if (id !== this.hover) {
      this.hover = id;
      this.dirty = true;
    }
  }
}

/** Shared drawing helpers (design tokens: one radius, glass panel, accent). */
export const ui = {
  panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(14,16,20,0.88)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 36);
    ctx.fill();
  },
  button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, o: { hover?: boolean; accent?: string; enabled?: boolean } = {}): void {
    ctx.fillStyle = o.enabled === false ? 'rgba(255,255,255,0.04)' : o.accent ?? (o.hover ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.1)');
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    if (o.hover && o.accent) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.fillStyle = o.enabled === false ? 'rgba(244,241,236,0.35)' : '#f4f1ec';
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1, w - 16);
    ctx.textAlign = 'left';
  },
  /** Word-wrapped text; returns the y after the last line. */
  wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 4): number {
    const words = text.split(' ');
    let line = '', lines = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y);
        y += lineH;
        line = w;
        if (++lines >= maxLines - 1) break;
      } else line = test;
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineH;
    }
    return y;
  },
};
