/**
 * A world-space panel drawn on a canvas, operable by an XR fingertip poke or a
 * mouse click (both resolve to registered hit regions). Subclasses implement
 * `paint(ctx, add)`, registering buttons with `add(x, y, w, h, id)`.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3, World } from '@iwsdk/core';
import { onSettings, settings } from '../core/settings.js';
import type { HandState } from '../platform/input/hand-state.js';
import { PokeGate } from '../platform/input/poke-gate.js';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

export abstract class CanvasPanel {
  /** Every panel, so a settings change (high contrast) can redraw them all. */
  static readonly all = new Set<CanvasPanel>();
  readonly mesh: Mesh;
  protected canvas = document.createElement('canvas');
  protected hover: string | null = null;
  private tex: CanvasTexture;
  private regions: Region[] = [];
  private dirty = true;
  /** Poke intent per hand (and one for a bare fingertip point), see PokeGate. */
  private gates = { left: new PokeGate(), right: new PokeGate(), tip: new PokeGate() };
  private local = new Vector3();
  private uv = new Vector2();
  private tipV = new Vector3();

  constructor(readonly px: [number, number], readonly size: [number, number]) {
    this.canvas.width = px[0];
    this.canvas.height = px[1];
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(size[0], size[1]), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 14;
    CanvasPanel.all.add(this);
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

  /** XR: returns the region id pressed this frame by a fingertip crossing the panel (with intent, see PokeGate). */
  poke(tip: Vector3 | null, now: number): string | null {
    const r = this.sample(tip, this.gates.tip, now, false);
    this.setHover(r.hover);
    return r.pressed;
  }

  /**
   * XR: either hand pokes (left-handed and one-handed players alike); a pinching hand never does
   * (it is grabbing or sculpting). Returns the region pressed this frame.
   */
  pokeHands(hands: readonly HandState[], now: number): string | null {
    let hover: string | null = null, pressed: string | null = null;
    for (const h of hands) {
      const r = this.sample(h.tracked ? this.tipV.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, this.gates[h.side], now, h.pinching);
      hover ??= r.hover;
      pressed ??= r.pressed;
    }
    this.setHover(hover);
    return pressed;
  }

  private sample(tip: Vector3 | null, gate: PokeGate, now: number, blocked: boolean): { hover: string | null; pressed: string | null } {
    if (!tip || !this.mesh.visible) {
      gate.reset();
      return { hover: null, pressed: null };
    }
    this.local.copy(tip);
    this.mesh.worldToLocal(this.local);
    const inside = Math.abs(this.local.x) < this.size[0] / 2 && Math.abs(this.local.y) < this.size[1] / 2;
    this.uv.set(this.local.x / this.size[0] + 0.5, this.local.y / this.size[1] + 0.5);
    const id = inside ? this.regionAtUv(this.uv) : null;
    const near = inside && this.local.z < 0.03 && this.local.z > -0.02;
    return { hover: near && !blocked ? id : null, pressed: gate.update(inside, this.local.z, id, now, blocked) };
  }

  setHover(id: string | null): void {
    if (id !== this.hover) {
      this.hover = id;
      this.dirty = true;
    }
  }
}

onSettings(() => {
  for (const p of CanvasPanel.all) p.invalidate();
});

/**
 * Mouse for a world-space panel in the browser: hover, and a click on it never
 * reaches the clay or objects behind it. Returns the cleanup.
 */
export function bindPanelMouse(world: World, panel: CanvasPanel, press: (id: string) => void, xr: () => boolean): () => void {
  const ray = new Raycaster(), ndc = new Vector2();
  const handle = (e: PointerEvent, down: boolean) => {
    // only presses on the 3D view: HTML on top (menu, dialogs) keeps its own clicks
    if (!panel.mesh.visible || xr() || e.target !== world.renderer.domElement) return;
    const r = world.renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, world.camera as PerspectiveCamera);
    const h = ray.intersectObject(panel.mesh, false)[0];
    const id = h?.uv ? panel.regionAtUv(h.uv) : null;
    panel.setHover(id);
    if (!down || !h) return;
    e.stopImmediatePropagation();
    if (id) press(id);
  };
  const onDown = (e: PointerEvent) => handle(e, true), onMove = (e: PointerEvent) => handle(e, false);
  addEventListener('pointerdown', onDown, { capture: true });
  addEventListener('pointermove', onMove);
  return () => {
    removeEventListener('pointerdown', onDown, { capture: true });
    removeEventListener('pointermove', onMove);
  };
}

/**
 * Headset panels are drawn 25% larger than their nominal size so body text is
 * >= 2.5 cm tall at 1 m (plan v4, section 7) at the ~0.5 m they float from the eyes.
 */
export let XR_TEXT_SCALE = 1.25;
/** Large text (V6 4.6): every headset panel 20% bigger again. A live binding: importers read the current value. */
onSettings((s) => (XR_TEXT_SCALE = s.largeText ? 1.5 : 1.25));

/** Shared drawing helpers (design tokens: one radius, glass panel, accent). High contrast: opaque, white outlines. */
export const ui = {
  panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = settings.highContrast ? '#000000' : 'rgba(14,16,20,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 36);
    ctx.fill();
    if (settings.highContrast) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  },
  button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, o: { hover?: boolean; accent?: string; enabled?: boolean } = {}): void {
    const hc = settings.highContrast;
    ctx.fillStyle = o.enabled === false ? 'rgba(255,255,255,0.04)' : o.accent ?? (o.hover ? (hc ? '#555' : 'rgba(255,255,255,0.24)') : hc ? '#222' : 'rgba(255,255,255,0.1)');
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    if ((o.hover && o.accent) || hc) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = hc ? 3 : 4;
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
      // the last allowed line keeps every remaining word (shortened with an ellipsis below)
      if (ctx.measureText(test).width > maxW && line && lines < maxLines - 1) {
        ctx.fillText(line, x, y);
        y += lineH;
        line = w;
        lines++;
      } else line = test;
    }
    if (line && ctx.measureText(line).width > maxW) {
      while (line.length > 1 && ctx.measureText(`${line}…`).width > maxW) line = line.slice(0, -1);
      line = `${line.trimEnd()}…`;
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineH;
    }
    return y;
  },
};
