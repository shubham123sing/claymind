/**
 * Material picker (plan v4, section 3): a ring of the 8 materials around the
 * piece the player last touched; one poke / click sets that piece's material.
 * The centre shows the current choice and what it means ("heavy, fragile").
 * Big targets (~3.5 cm), poke in XR, click in the browser.
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { getMaterial, MATERIALS, materialTraits } from '../materials/materials.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { CanvasPanel, ui } from './canvas-panel.js';

const PX = 640;
const SIZE = 0.2; // m: buttons are ~3.5 cm across
const R_RING = 228, R_BTN = 74;
const IDLE_CLOSE_MS = 12000;

class PickerPanel extends CanvasPanel {
  current = 'clay';
  constructor() {
    super([PX, PX], [SIZE, SIZE]);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const c = PX / 2;
    ctx.fillStyle = 'rgba(14,16,20,0.78)';
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.fill();
    MATERIALS.forEach((m, i) => {
      const a = -Math.PI / 2 + (i / MATERIALS.length) * Math.PI * 2;
      const x = c + Math.cos(a) * R_RING, y = c + Math.sin(a) * R_RING;
      const on = m.id === this.current, hover = this.hover === m.id;
      ctx.fillStyle = m.visual.color;
      ctx.beginPath();
      ctx.arc(x, y, R_BTN * (hover ? 1.08 : 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = on ? 10 : hover ? 6 : 3;
      ctx.strokeStyle = on ? '#f6c855' : hover ? '#ffffff' : 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.fillStyle = '#101216';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 6;
      ctx.strokeText(m.name, x, y);
      ctx.fillText(m.name, x, y);
      add(x - R_BTN, y - R_BTN, R_BTN * 2, R_BTN * 2, m.id);
    });
    const m = getMaterial(this.current);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText(m.name, c, c - 24);
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.8)';
    ui.wrap(ctx, materialTraits(m).join(', '), c - 120 + 120, c + 24, 240, 34, 2);
    ctx.textAlign = 'left';
  }
}

export class MaterialPickerSystem extends createSystem({}) {
  private panel = new PickerPanel();
  private target: { creationId: string; part: number } | null = null;
  private openedAt = 0;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private tip = new Vector3();
  private v = new Vector3();

  init(): void {
    this.panel.mesh.visible = false;
    this.panel.mesh.renderOrder = 22;
    // always readable: drawn over the clay and objects
    const mat = this.panel.mesh.material as { depthTest: boolean };
    mat.depthTest = false;
    this.world.createTransformEntity(this.panel.mesh);
    this.cleanupFuncs.push(bus.on('material:toggle', () => (this.panel.mesh.visible ? this.close() : this.open())));
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

  private open(): void {
    const t = this.world.getSystem(ObjectSystem)?.focusTarget();
    if (!t) {
      bus.emit('ui:toast', { text: 'Bring something to life, touch a piece, then pick its material' });
      return;
    }
    this.target = { creationId: t.creationId, part: t.part };
    this.panel.current = t.materialId;
    this.panel.invalidate();
    this.place(t.position, t.radius, true);
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    uiSounds.tick();
  }

  /** Just in front of the object (toward the viewer), a little above it, facing the viewer; follows it. */
  private place(at: Vector3, radius: number, snap: boolean): void {
    const m = this.panel.mesh;
    const eye = this.world.camera.getWorldPosition(this.v);
    const toEye = this.toEye.copy(eye).sub(at).setY(0);
    if (toEye.lengthSq() < 1e-6) toEye.set(0, 0, 1);
    toEye.normalize();
    if (input.xr) {
      // arm's length in the headset: full size, just in front of the object
      m.scale.setScalar(1);
      this.goal.copy(at).addScaledVector(toEye, Math.min(radius, 0.12) + 0.06);
      this.goal.y += 0.06;
    } else {
      // the desktop camera sits close to the table: smaller, centred on the object
      m.scale.setScalar(0.5);
      this.goal.copy(at).addScaledVector(toEye, Math.min(radius, 0.08));
    }
    // snap (no glide): the buttons must be exactly where they are drawn when pressed
    void snap;
    m.position.copy(this.goal);
    m.lookAt(eye);
  }
  private toEye = new Vector3();
  private goal = new Vector3();

  private close(): void {
    this.panel.mesh.visible = false;
    this.target = null;
  }

  private pick(id: string): void {
    if (!this.target) return;
    const m = getMaterial(id);
    bus.emit('creation:set-material', { creationId: this.target.creationId, materialId: m.id, by: 'user', confidence: 1, part: this.target.part });
    bus.emit('ui:toast', { text: `${m.name} · ${materialTraits(m).join(', ')}`, color: m.visual.color });
    uiSounds.tick(2);
    this.close();
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    // only presses on the 3D view: HTML on top (menu, dialogs) keeps its own clicks
    if (!this.panel.mesh.visible || input.xr || e.target !== this.world.renderer.domElement) return;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    const h = this.ray.intersectObject(this.panel.mesh, false)[0];
    const id = h?.uv ? this.panel.regionAtUv(h.uv) : null;
    this.panel.setHover(id);
    if (!down) return;
    if (h) {
      e.stopImmediatePropagation(); // a click on the picker never sculpts or grabs
      if (id) this.pick(id);
    } else if (e.target === this.world.renderer.domElement) this.close();
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    const now = performance.now();
    const at = this.target && this.world.getSystem(ObjectSystem)?.placeOf(this.target.creationId);
    if (!at || now - this.openedAt > IDLE_CLOSE_MS) {
      this.close();
      return;
    }
    this.place(at.position, at.radius, false);
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const id = this.panel.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, now);
      if (id) this.pick(id);
    }
    this.panel.draw();
  }
}
