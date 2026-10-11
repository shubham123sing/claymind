/**
 * Library (plan v4, section 6): creations are saved automatically (IndexedDB)
 * whenever they change; pinned ones come back to their spot on the table after
 * a reload. The shelf panel shows thumbnails: tap one to bring it back, tap its
 * x twice to delete it, "Re-place pinned" puts pinned creations back on the
 * table as it is found now (anchors are unverified on Quest Browser).
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { getMaterial } from '../materials/materials.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { surface } from '../platform/surface/surface-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { deleteFromLibrary, loadLibrary, SavedCreation, saveToLibrary } from '../storage/library.js';
import { setSetting, settings, settingsReady } from '../core/settings.js';
import { buildSamples } from '../objects/samples.js';
import { CanvasPanel, ui } from './canvas-panel.js';

const W = 1000, H = 640;
const SIZE: [number, number] = [0.3, (0.3 * H) / W];
const COLS = 4, ROWS = 2, PER_PAGE = COLS * ROWS;
const SAVE_DELAY_MS = 800;
const IDLE_CLOSE_MS = 30000;

class LibraryPanel extends CanvasPanel {
  items: SavedCreation[] = [];
  page = 0;
  armedDelete: string | null = null;
  inRoom = new Set<string>();
  private images = new Map<string, HTMLImageElement>();
  constructor() {
    super([W, H], SIZE);
  }

  private image(s: SavedCreation): HTMLImageElement | null {
    let img = this.images.get(s.id + s.savedAt);
    if (!img) {
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = s.thumb;
      this.images.set(s.id + s.savedAt, img);
    }
    return img.complete ? img : null;
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 36px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Library', 32, 44);
    ctx.font = '500 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.fillText(this.items.length ? `${this.items.length} saved · tap one to bring it back` : 'Bring something to life: it is saved here', 190, 46);
    const cw = (W - 40) / COLS, ch = 230, top = 90;
    const pageItems = this.items.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    pageItems.forEach((s, i) => {
      const x = 20 + (i % COLS) * cw, y = top + Math.floor(i / COLS) * (ch + 14);
      const hover = this.hover === `o${s.id}`;
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(x + 6, y, cw - 12, ch, 18);
      ctx.fill();
      add(x + 6, y, cw - 12, ch, `o${s.id}`);
      const img = this.image(s);
      if (img) ctx.drawImage(img, x + (cw - 150) / 2, y + 10, 150, 150);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const mats = [...new Set(s.parts.map((p) => getMaterial(p.materialId).name))].join(' + ');
      ctx.fillText(mats, x + cw / 2, y + 180, cw - 24);
      ctx.font = '500 18px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(244,241,236,0.65)';
      const tags = [s.pinned ? 'pinned' : '', this.inRoom.has(s.id) ? 'in the room' : ''].filter(Boolean).join(' · ');
      ctx.fillText(tags || `${Math.round(s.creation.massKg * 1000)} g`, x + cw / 2, y + 208, cw - 24);
      ctx.textAlign = 'left';
      // delete (two taps)
      const dx = x + cw - 52, dy = y + 6, armed = this.armedDelete === s.id;
      ctx.fillStyle = armed ? '#d9534f' : this.hover === `x${s.id}` ? 'rgba(217,83,79,0.6)' : 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(dx + 20, dy + 20, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(armed ? '?' : '×', dx + 20, dy + 21);
      ctx.textAlign = 'left';
      add(dx, dy, 40, 40, `x${s.id}`);
    });
    const pages = Math.max(1, Math.ceil(this.items.length / PER_PAGE));
    const by = H - 70;
    const btn = (x: number, w: number, label: string, id: string, enabled = true) => {
      if (enabled) add(x, by, w, 56, id);
      ui.button(ctx, x, by, w, 56, label, { hover: this.hover === id, enabled });
    };
    btn(20, 90, '◀', 'prev', this.page > 0);
    btn(120, 90, '▶', 'next', this.page < pages - 1);
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText(`${this.page + 1} / ${pages}`, 230, by + 29);
    btn(W - 20 - 300, 300, 'Re-place pinned', 'replace', this.items.some((s) => s.pinned));
  }
}

export class LibrarySystem extends createSystem({}) {
  private panel = new LibraryPanel();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private restoredFor = -1;
  private openedAt = 0;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private tip = new Vector3();
  private v = new Vector3();
  private at = new Vector3();
  private toEye = new Vector3();
  private left = new Vector3();
  private loaded = false;

  init(): void {
    const m = this.panel.mesh;
    m.visible = false;
    m.renderOrder = 22;
    (m.material as { depthTest: boolean }).depthTest = false;
    this.world.createTransformEntity(m);
    this.cleanupFuncs.push(
      bus.on('creation:changed', (e) => this.scheduleSave(e.creationId)),
      bus.on('creation:removed', (e) => void this.remove(e.creationId)),
      bus.on('library:toggle', () => (m.visible ? this.close() : this.open())),
    );
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
    void Promise.all([loadLibrary(), settingsReady]).then(([items]) => {
      this.panel.items = items;
      this.loaded = true;
      console.info(`[library] ${items.length} saved, ${items.filter((s) => s.pinned).length} pinned`);
      // first run: a few ready-made creations so the shelf is never empty
      if (!settings.samplesAdded && items.length === 0) setTimeout(() => void this.addSamples(), 2500);
    });
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private scheduleSave(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.save(id), SAVE_DELAY_MS));
  }

  private async save(id: string): Promise<void> {
    this.timers.delete(id);
    const s = this.objects.serialize(id);
    if (!s) return;
    await saveToLibrary(s);
    this.panel.items = [s, ...this.panel.items.filter((x) => x.id !== id)];
    this.panel.invalidate();
  }

  private async addSamples(): Promise<void> {
    setSetting('samplesAdded', true);
    const t0 = performance.now();
    for (const s of buildSamples()) {
      const saved = this.objects.makeSaved(s.creation, s.parts);
      await saveToLibrary(saved);
      this.panel.items.push(saved);
    }
    this.panel.invalidate();
    console.info(`[library] added ${this.panel.items.length} samples in ${Math.round(performance.now() - t0)} ms`);
  }

  private async remove(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    await deleteFromLibrary(id);
    this.panel.items = this.panel.items.filter((x) => x.id !== id);
    this.panel.invalidate();
  }

  /** Pinned creations back on the table (after loading, and on "Re-place pinned"). */
  private placePinned(): number {
    let n = 0;
    for (const s of this.panel.items) {
      if (!s.pinned) continue;
      if (this.objects.liveCreationIds().includes(s.id)) this.objects.removeCreation(s.id);
      this.objects.restore(s, 'saved');
      n++;
    }
    return n;
  }

  private open(): void {
    this.panel.inRoom = new Set(this.objects.liveCreationIds());
    this.panel.invalidate();
    this.place();
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
    this.panel.armedDelete = null;
  }

  private place(): void {
    const m = this.panel.mesh;
    const eye = this.world.camera.getWorldPosition(this.v);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.at);
    const toEye = this.toEye.copy(eye).sub(at).setY(0).normalize();
    const left = this.left.set(-toEye.z, 0, toEye.x);
    if (input.xr) {
      m.scale.setScalar(1);
      m.position.copy(at).addScaledVector(toEye, 0.1).addScaledVector(left, -0.24);
      m.position.y += 0.14;
    } else {
      m.scale.setScalar(0.5);
      m.position.copy(at).addScaledVector(toEye, 0.12).addScaledVector(left, -0.12);
      m.position.y += 0.06;
    }
    m.lookAt(eye);
  }

  private press(id: string): void {
    const p = this.panel;
    this.openedAt = performance.now();
    if (id === 'prev' || id === 'next') p.page += id === 'next' ? 1 : -1;
    else if (id === 'replace') bus.emit('ui:toast', { text: `Re-placed ${this.placePinned()} pinned creation(s) on the table` });
    else if (id.startsWith('x')) {
      const sid = id.slice(1);
      if (p.armedDelete === sid) {
        p.armedDelete = null;
        void this.remove(sid);
        bus.emit('ui:toast', { text: 'Deleted from the Library' });
      } else {
        p.armedDelete = sid;
        bus.emit('ui:toast', { text: 'Tap again to delete it' });
      }
    } else if (id.startsWith('o')) {
      const s = p.items.find((x) => x.id === id.slice(1));
      if (s) bus.emit('ui:toast', { text: this.objects.restore(s, s.pinned ? 'saved' : 'present') });
      p.inRoom = new Set(this.objects.liveCreationIds());
    }
    uiSounds.tick();
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
    e.stopImmediatePropagation();
    if (id) this.press(id);
  }

  update(): void {
    // pinned creations come back once the library is loaded and the work surface is known
    if (this.loaded && this.restoredFor < 0 && performance.now() > 1500) {
      this.restoredFor = surface.version;
      const n = this.placePinned();
      if (n) bus.emit('ui:toast', { text: `${n} pinned creation(s) back on the table` });
    } else if (this.restoredFor >= 0 && surface.real && surface.version !== this.restoredFor && this.panel.items.some((s) => s.pinned)) {
      this.restoredFor = surface.version;
      bus.emit('ui:toast', { text: 'Table found: Library -> Re-place pinned puts your pinned things on it' });
    }
    if (!this.panel.mesh.visible) return;
    const now = performance.now();
    if (now - this.openedAt > IDLE_CLOSE_MS) return this.close();
    this.place();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const id = this.panel.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, now);
      if (id) this.press(id);
    }
    this.panel.draw();
  }
}
