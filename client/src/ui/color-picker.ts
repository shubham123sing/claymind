/**
 * Colour picker (plan v4, sections 3-4): hue ring + lightness bar + 8 quick
 * swatches. The chosen colour is the paint brush colour; "Whole piece" colours
 * the piece the player last touched (a clay piece, or a piece of an object),
 * "Material colour" goes back to the material's own. Paint / Eraser and the
 * brush size are here too. Colour never changes physics.
 * Poke in XR, click in the browser.
 */
import { Color, createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { brush } from '../sculpt/tools.js';
import { CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';

const W = 960, H = 600;
const SIZE: [number, number] = [0.27, (0.27 * H) / W];
const RING = { x: 230, y: 300, r: 182, seg: 24, cell: 54 };
const LIGHT_STEPS = 9;
const SWATCHES = ['#f4f1ec', '#1d1f24', '#d9534f', '#f0b429', '#5fbf72', '#4f8fe0', '#9b7bd4', '#e2733b'];
const IDLE_CLOSE_MS = 20000;

type Target = { kind: 'clay'; piece: number } | { kind: 'object'; creationId: string; part: number };

const hex = (c: Color) => `#${c.getHexString()}`;

class ColorPanel extends CanvasPanel {
  hue = 0;
  light = 0.5;
  current = '#d9534f';
  tool = 'shape';
  targetText = '';
  constructor() {
    super([W, H], SIZE);
  }

  lightColor(i: number): string {
    return hex(new Color().setHSL(this.hue / 360, 0.75, 0.12 + (i / (LIGHT_STEPS - 1)) * 0.8));
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    // hue ring
    for (let i = 0; i < RING.seg; i++) {
      const a = (i / RING.seg) * Math.PI * 2 - Math.PI / 2;
      const x = RING.x + Math.cos(a) * RING.r, y = RING.y + Math.sin(a) * RING.r;
      ctx.fillStyle = `hsl(${(i / RING.seg) * 360}, 75%, 50%)`;
      ctx.beginPath();
      ctx.arc(x, y, RING.cell / 2 + (this.hover === `h${i}` ? 5 : 0), 0, Math.PI * 2);
      ctx.fill();
      if (Math.round((this.hue / 360) * RING.seg) % RING.seg === i) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      add(x - RING.cell / 2, y - RING.cell / 2, RING.cell, RING.cell, `h${i}`);
    }
    // preview
    ctx.fillStyle = this.current;
    ctx.beginPath();
    ctx.arc(RING.x, RING.y, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // lightness bar
    const lx = 470, lw = (W - 30 - lx) / LIGHT_STEPS;
    for (let i = 0; i < LIGHT_STEPS; i++) {
      ctx.fillStyle = this.lightColor(i);
      ctx.beginPath();
      ctx.roundRect(lx + i * lw + 3, 36, lw - 6, 70, 14);
      ctx.fill();
      if (this.hover === `l${i}`) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      add(lx + i * lw, 36, lw, 70, `l${i}`);
    }
    // swatches
    const sw = (W - 30 - lx) / SWATCHES.length;
    SWATCHES.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(lx + i * sw + sw / 2, 160, sw / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.hover === `s${i}` ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = this.hover === `s${i}` ? 5 : 2;
      ctx.stroke();
      add(lx + i * sw, 160 - sw / 2, sw, sw, `s${i}`);
    });
    // actions
    const bw = (W - 30 - lx - 16) / 2;
    const btn = (x: number, y: number, w: number, label: string, id: string, accent?: string) => {
      add(x, y, w, 72, id);
      ui.button(ctx, x, y, w, 72, label, { hover: this.hover === id, accent });
    };
    btn(lx, 222, bw, 'Whole piece', 'piece', '#e2733b');
    btn(lx + bw + 16, 222, bw, 'Material colour', 'natural');
    btn(lx, 310, bw, 'Paint', 'paint', this.tool === 'paint' ? '#5fbf72' : undefined);
    btn(lx + bw + 16, 310, bw, 'Eraser', 'erase', this.tool === 'erase' ? '#5fbf72' : undefined);
    btn(lx, 398, 90, '−', 'smaller');
    btn(W - 30 - 90, 398, 90, '+', 'bigger');
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Brush ${Math.round(brush.size * 2000)} mm`, (lx + W - 30) / 2, 434);
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.75)';
    ctx.fillText(this.targetText, (lx + W - 30) / 2, 530, W - 30 - lx);
    ctx.textAlign = 'left';
  }
}

export class ColorPickerSystem extends createSystem({}) {
  private panel = new ColorPanel();
  private target: Target | null = null;
  private openedAt = 0;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private tip = new Vector3();
  private v = new Vector3();
  private goal = new Vector3();
  private left = new Vector3();

  init(): void {
    const m = this.panel.mesh;
    m.visible = false;
    m.renderOrder = 22;
    (m.material as { depthTest: boolean }).depthTest = false;
    this.world.createTransformEntity(m);
    this.cleanupFuncs.push(bus.on('color:toggle', () => (m.visible ? this.close() : this.open())));
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && this.close();
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
      removeEventListener('keydown', onKey);
    });
  }

  private get sculpt() {
    return this.world.getSystem(SculptSystem)!;
  }
  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private open(): void {
    // the object if the player touched one after the clay, else the clay piece
    const t = this.objects.focusTarget();
    if (t && this.objects.lastObjectTouch > this.sculpt.lastClayTouch) {
      this.target = { kind: 'object', creationId: t.creationId, part: t.part };
      this.panel.targetText = `For the touched object, piece ${t.part + 1}`;
    } else {
      const c = this.sculpt.clayTarget();
      this.target = { kind: 'clay', piece: c.piece };
      this.panel.targetText = `For the clay, piece ${c.piece + 1}`;
    }
    const cur = new Color(this.sculpt.paintColor);
    const hsl = { h: 0, s: 0, l: 0 };
    cur.getHSL(hsl);
    this.panel.hue = hsl.h * 360;
    this.panel.current = hex(cur);
    this.panel.tool = this.sculpt.toolId;
    this.panel.invalidate();
    this.place();
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
    this.target = null;
  }

  /** Beside what it colours, facing the viewer; snapped every frame so buttons are where they are drawn. */
  private place(): void {
    const m = this.panel.mesh;
    const eye = this.world.camera.getWorldPosition(this.v);
    let at: Vector3 | null = null, radius = 0.06;
    if (this.target?.kind === 'object') {
      const p = this.objects.placeOf(this.target.creationId);
      if (p) (at = p.position), (radius = p.radius);
    }
    at ??= this.sculpt.clayCenterWorld();
    const toEye = this.goal.copy(eye).sub(at).setY(0);
    if (toEye.lengthSq() < 1e-6) toEye.set(0, 0, 1);
    toEye.normalize();
    const left = this.left.set(-toEye.z, 0, toEye.x); // the viewer's left of the target
    if (input.xr) {
      m.scale.setScalar(XR_TEXT_SCALE);
      m.position.copy(at).addScaledVector(toEye, 0.08).addScaledVector(left, radius + SIZE[0] / 2);
      m.position.y += 0.05;
    } else {
      // desktop: to the right (the toolbar is on the left of the screen)
      m.scale.setScalar(0.55);
      m.position.copy(at).addScaledVector(toEye, Math.min(radius, 0.08)).addScaledVector(left, -(radius + 0.09));
      m.position.y += 0.02;
    }
    m.lookAt(eye);
  }

  private press(id: string): void {
    const p = this.panel;
    const pick = (c: string) => {
      p.current = c;
      this.sculpt.paintColor = new Color(c).getHex();
      uiSounds.tick();
    };
    if (id.startsWith('h')) {
      p.hue = (Number(id.slice(1)) / RING.seg) * 360;
      pick(p.lightColor(Math.round((LIGHT_STEPS - 1) / 2)));
    } else if (id.startsWith('l')) pick(p.lightColor(Number(id.slice(1))));
    else if (id.startsWith('s')) pick(SWATCHES[Number(id.slice(1))]);
    else if (id === 'piece' || id === 'natural') {
      const color = id === 'piece' ? p.current : null;
      const t = this.target;
      if (t?.kind === 'object') this.objects.setPieceColor(t.creationId, t.part, color);
      else if (t) this.sculpt.setPieceColor(t.piece, color);
      bus.emit('ui:toast', { text: color ? 'Piece coloured (looks only, the material is unchanged)' : 'Back to the material colour', color: color ?? undefined });
      uiSounds.tick(2);
    } else if (id === 'paint' || id === 'erase') {
      this.sculpt.selectTool(id);
      p.tool = id;
      bus.emit('ui:toast', { text: id === 'paint' ? 'Paint: touch the clay to draw' : 'Eraser: touch the paint to remove it', color: p.current });
    } else if (id === 'smaller' || id === 'bigger') this.sculpt.brushSize(id === 'bigger' ? 1 : -1);
    this.openedAt = performance.now();
    p.invalidate();
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (!this.panel.mesh.visible || input.xr) return;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    const h = this.ray.intersectObject(this.panel.mesh, false)[0];
    const id = h?.uv ? this.panel.regionAtUv(h.uv) : null;
    this.panel.setHover(id);
    if (!down || !h) return;
    e.stopImmediatePropagation(); // a click on the picker never sculpts, paints or grabs
    if (id) this.press(id);
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    const now = performance.now();
    if (now - this.openedAt > IDLE_CLOSE_MS || (this.target?.kind === 'object' && !this.objects.placeOf(this.target.creationId))) {
      this.close();
      return;
    }
    this.place();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const id = this.panel.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, now);
      if (id) this.press(id);
    }
    this.panel.draw();
  }
}
