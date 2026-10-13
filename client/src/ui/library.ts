/**
 * Library: only what the player adds. "Add to Library" (menu or the panel's
 * button) saves a named copy of the current creation with a thumbnail. The
 * panel shows a grid; select an item, then Use (a copy into the room, the item
 * never changes), Edit (a linked copy: its changes are saved back to the item),
 * Rename, Download or Delete (two taps, then a 5-second Undo).
 * Pinned creations are kept separately (the 'room' store) and come back to
 * their spot on the table after a reload; "Re-place pinned" puts them back on
 * the table as it is found now (anchors are unverified on Quest Browser).
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { getMaterial } from '../materials/materials.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { surface } from '../platform/surface/surface-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { copySaved, deleteFromLibrary, loadLibrary, nextClayName, SavedCreation, saveToLibrary } from '../storage/library.js';
import { CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';
import { offerUndo } from './undo-toast.js';

const W = 1000, H = 640;
const SIZE: [number, number] = [0.3, (0.3 * H) / W];
const COLS = 4, ROWS = 2, PER_PAGE = COLS * ROWS;
const SAVE_DELAY_MS = 800;
const IDLE_CLOSE_MS = 30000;
const CONFIRM_MS = 3000;
const ACTIONS = [
  ['use', 'Use'], ['edit', 'Edit'], ['rename', 'Rename'], ['download', 'Download'], ['delete', 'Delete'],
] as const;

class LibraryPanel extends CanvasPanel {
  items: SavedCreation[] = [];
  page = 0;
  selected: string | null = null;
  armedDelete = false;
  canReplace = false;
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
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.fillText(this.items.length ? `${this.items.length} saved` : 'Empty: make something, then Add', 175, 46);
    const hb = (x: number, w: number, label: string, id: string, enabled = true) => {
      if (enabled) add(x, 18, w, 52, id);
      ui.button(ctx, x, 18, w, 52, label, { hover: this.hover === id, enabled });
    };
    if (this.canReplace) hb(W - 20 - 250 - 12 - 220, 220, 'Re-place pinned', 'replace');
    hb(W - 20 - 250, 250, '+ Add to Library', 'add');

    const cw = (W - 40) / COLS, ch = 210, top = 86;
    const pageItems = this.items.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    pageItems.forEach((s, i) => {
      const x = 20 + (i % COLS) * cw, y = top + Math.floor(i / COLS) * (ch + 12);
      const sel = this.selected === s.id;
      const hover = this.hover === `o${s.id}`;
      ctx.fillStyle = sel ? 'rgba(240,180,41,0.35)' : hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(x + 6, y, cw - 12, ch, 18);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = '#f0b429';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      add(x + 6, y, cw - 12, ch, `o${s.id}`);
      const img = this.image(s);
      if (img) ctx.drawImage(img, x + (cw - 136) / 2, y + 8, 136, 136);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.creation.name, x + cw / 2, y + 164, cw - 24);
      ctx.font = '500 17px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(244,241,236,0.65)';
      const mats = [...new Set(s.parts.map((p) => getMaterial(p.materialId).name))].join(' + ');
      ctx.fillText(`${mats} · ${Math.round(s.creation.massKg * 1000)} g`, x + cw / 2, y + 190, cw - 24);
      ctx.textAlign = 'left';
    });

    const pages = Math.max(1, Math.ceil(this.items.length / PER_PAGE));
    const by = H - 72;
    const btn = (x: number, w: number, label: string, id: string, enabled = true, danger = false) => {
      if (enabled) add(x, by, w, 56, id);
      ui.button(ctx, x, by, w, 56, label, { hover: this.hover === id, enabled, accent: danger ? '#d9534f' : undefined });
    };
    btn(20, 72, '◀', 'prev', this.page > 0);
    btn(100, 72, '▶', 'next', this.page < pages - 1);
    const has = this.selected !== null;
    ACTIONS.forEach(([id, label], i) => {
      const text = id === 'delete' && this.armedDelete ? 'Sure?' : label;
      btn(190 + i * 158, 150, text, id, has, id === 'delete' && this.armedDelete);
    });
  }
}

export class LibrarySystem extends createSystem({}) {
  private panel = new LibraryPanel();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Pinned creations (room store), put back after a reload. */
  private room: SavedCreation[] = [];
  /** Live creation id -> Library item it edits (Edit). */
  private editing = new Map<string, string>();
  private restoredFor = -1;
  private openedAt = 0;
  private armedAt = -Infinity;
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
      bus.on('creation:removed', (e) => this.forget(e.creationId)),
      bus.on('library:toggle', () => (m.visible ? this.close() : this.open())),
      bus.on('library:add', () => void this.add()),
    );
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
    void Promise.all([loadLibrary(), loadLibrary('room')]).then(([items, room]) => {
      this.panel.items = items;
      this.room = room.filter((s) => s.pinned);
      this.loaded = true;
      console.info(`[library] ${items.length} in the Library, ${this.room.length} pinned in the room`);
    });
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  // ---------- room (pinned) and Edit links: saved as they change ----------

  private scheduleSave(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.saveLive(id), SAVE_DELAY_MS));
  }

  private async saveLive(id: string): Promise<void> {
    this.timers.delete(id);
    const s = this.objects.serialize(id);
    if (!s) return;
    if (s.pinned) {
      await saveToLibrary(s, 'room');
      this.room = [s, ...this.room.filter((x) => x.id !== id)];
    } else if (this.room.some((x) => x.id === id)) this.dropRoom(id);
    const libId = this.editing.get(id);
    const item = libId && this.panel.items.find((x) => x.id === libId);
    if (item) {
      const updated = copySaved(s, item.id, item.creation.name);
      updated.pinned = false;
      await saveToLibrary(updated);
      this.panel.items = this.panel.items.map((x) => (x.id === item.id ? updated : x));
      this.panel.invalidate();
    }
  }

  private forget(id: string): void {
    clearTimeout(this.timers.get(id));
    this.editing.delete(id);
    if (this.room.some((x) => x.id === id)) this.dropRoom(id);
  }

  private dropRoom(id: string): void {
    this.room = this.room.filter((x) => x.id !== id);
    void deleteFromLibrary(id, 'room');
  }

  // ---------- Library actions ----------

  /** The creation being worked on: the object touched last, else the newest one in the room. */
  private current(): string | null {
    const t = this.objects.focusTarget();
    if (t) return t.creationId;
    const ids = this.objects.liveCreationIds().filter((x) => !x.includes('#exp'));
    return ids[ids.length - 1] ?? null;
  }

  private askName(title: string, fallback: string): string | null {
    if (input.xr || typeof prompt !== 'function') return fallback; // no keyboard in the headset: the default name
    const name = prompt(title, fallback);
    return name === null ? null : name.trim().slice(0, 40) || fallback;
  }

  async add(): Promise<void> {
    const id = this.current();
    const s = id ? this.objects.serialize(id) : null;
    if (!s) {
      bus.emit('ui:toast', { text: id ? 'One moment, the material is still settling' : 'Bring something to life first, then Add to Library' });
      return;
    }
    const name = this.askName('Name for the Library', nextClayName(this.panel.items.map((x) => x.creation.name)));
    if (name === null) return;
    const item = copySaved(s, `lib_${Date.now().toString(36)}`, name);
    item.pinned = false;
    await saveToLibrary(item);
    this.panel.items = [item, ...this.panel.items];
    this.panel.selected = item.id;
    this.panel.page = 0;
    this.panel.invalidate();
    uiSounds.tick();
    offerUndo(`Added "${name}" to the Library`, () => void this.removeItem(item.id), input.xr);
  }

  private async removeItem(id: string): Promise<void> {
    await deleteFromLibrary(id);
    this.panel.items = this.panel.items.filter((x) => x.id !== id);
    if (this.panel.selected === id) this.panel.selected = null;
    for (const [live, lib] of this.editing) if (lib === id) this.editing.delete(live);
    this.panel.invalidate();
  }

  private bringIn(s: SavedCreation, link: boolean): void {
    const copy = copySaved(s, `c_${Date.now().toString(36)}_lib`);
    copy.pinned = false;
    bus.emit('ui:toast', { text: link ? `Editing "${s.creation.name}": changes are saved to the Library` : this.objects.restore(copy, 'present') });
    if (link) {
      this.objects.restore(copy, 'present');
      this.editing.set(copy.id, s.id);
    }
    this.objects.focusOn(copy.id);
  }

  private action(id: string): void {
    const p = this.panel;
    const s = p.items.find((x) => x.id === p.selected);
    if (!s) return;
    if (id !== 'delete') p.armedDelete = false;
    if (id === 'use') this.bringIn(s, false);
    else if (id === 'edit') this.bringIn(s, true);
    else if (id === 'rename') {
      if (input.xr) {
        bus.emit('ui:toast', { text: 'Rename needs a keyboard: open ClayMind in a browser' });
        return;
      }
      const name = this.askName('New name', s.creation.name);
      if (name === null || name === s.creation.name) return;
      const renamed: SavedCreation = { ...s, creation: { ...s.creation, name } };
      void saveToLibrary(renamed);
      p.items = p.items.map((x) => (x.id === s.id ? renamed : x));
    } else if (id === 'download') bus.emit('library:download', { item: s });
    else if (id === 'delete') {
      const now = performance.now();
      if (!p.armedDelete || now - this.armedAt > CONFIRM_MS) {
        p.armedDelete = true;
        this.armedAt = now;
        bus.emit('ui:toast', { text: `Delete "${s.creation.name}"? Tap again. It goes after 5 s unless you Undo` });
        return;
      }
      p.armedDelete = false;
      const index = p.items.indexOf(s);
      void this.removeItem(s.id);
      offerUndo(`Deleted "${s.creation.name}"`, () => {
        void saveToLibrary(s);
        p.items.splice(Math.min(index, p.items.length), 0, s);
        p.selected = s.id;
        p.invalidate();
      }, input.xr);
    }
  }

  /** Pinned creations back on the table (after loading, and on "Re-place pinned"). */
  private placePinned(): number {
    let n = 0;
    for (const s of this.room) {
      if (this.objects.liveCreationIds().includes(s.id)) this.objects.removeCreation(s.id);
      this.objects.restore(s, 'saved');
      n++;
    }
    return n;
  }

  private open(): void {
    this.panel.canReplace = this.room.length > 0;
    this.panel.invalidate();
    this.place();
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
    this.panel.armedDelete = false;
  }

  private place(): void {
    const m = this.panel.mesh;
    const eye = this.world.camera.getWorldPosition(this.v);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.at);
    const toEye = this.toEye.copy(eye).sub(at).setY(0).normalize();
    const left = this.left.set(-toEye.z, 0, toEye.x);
    if (input.xr) {
      m.scale.setScalar(XR_TEXT_SCALE);
      m.position.copy(at).addScaledVector(toEye, 0.1).addScaledVector(left, -0.24);
      m.position.y += 0.14;
    } else {
      // beside the clay on a wide window; centred in front of it on a narrow one (all buttons in view)
      const narrow = (this.world.camera as PerspectiveCamera).aspect < 1.3;
      m.scale.setScalar(0.5);
      m.position.copy(at).addScaledVector(toEye, narrow ? 0.16 : 0.12).addScaledVector(left, narrow ? 0 : -0.12);
      m.position.y += 0.06;
    }
    m.lookAt(eye);
  }

  private press(id: string): void {
    const p = this.panel;
    this.openedAt = performance.now();
    if (id === 'prev' || id === 'next') p.page += id === 'next' ? 1 : -1;
    else if (id === 'replace') bus.emit('ui:toast', { text: `Re-placed ${this.placePinned()} pinned creation(s) on the table` });
    else if (id === 'add') void this.add();
    else if (id.startsWith('o')) {
      p.selected = id.slice(1);
      p.armedDelete = false;
    } else this.action(id);
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
    // pinned creations come back once loaded and the work surface is known
    if (this.loaded && this.restoredFor < 0 && performance.now() > 1500) {
      this.restoredFor = surface.version;
      const n = this.placePinned();
      if (n) bus.emit('ui:toast', { text: `${n} pinned creation(s) back on the table` });
    } else if (this.restoredFor >= 0 && surface.real && surface.version !== this.restoredFor && this.room.length) {
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
