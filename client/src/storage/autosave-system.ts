/**
 * Autosave (V6, section 6): a crash or a closed tab loses nothing. The clay (with its undo history)
 * is saved a few seconds after it changes, the loose creations on the table (pinned ones are the
 * Library's 'room' store) every few seconds and when the page is hidden. On the next launch both come
 * back. Local only (IndexedDB); paused while in a multiplayer room (the room has its own state).
 */
import { createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { room } from '../multiplayer/room-client.js';
import { ObjectSystem } from '../objects/object-system.js';
import type { SculptSnapshot } from '../sculpt/sculpt-engine.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { idbGet, idbSet } from './idb.js';
import { LIBRARY_SCHEMA, type SavedCreation } from './library.js';

const CLAY_EVERY_MS = 4000;
const OBJECTS_EVERY_MS = 8000;
/** After this the Library has put pinned creations back; then the autosave comes back. */
const RESTORE_AFTER_MS = 2500;

export class AutosaveSystem extends createSystem({}) {
  private restored = false;
  private busy = false;
  private clayAt = 0;
  private objectsAt = 0;
  private dirty = false;
  private lastClay: number | null = null;
  private saved: SavedCreation[] = [];
  /** QA: saves so far. */
  stats = { clay: 0, objects: 0, restoredClay: false, restoredObjects: 0 };

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private get sculpt() {
    return this.world.getSystem(SculptSystem)!;
  }

  init(): void {
    const mark = () => (this.dirty = true);
    const hidden = () => {
      if (document.visibilityState === 'hidden') void this.save(true);
    };
    document.addEventListener('visibilitychange', hidden);
    addEventListener('pagehide', hidden);
    this.cleanupFuncs.push(
      bus.on('creation:baked', mark),
      bus.on('creation:changed', mark),
      bus.on('creation:removed', mark),
      bus.on('object:pinned', mark),
      bus.on('scene:clear', mark),
      () => {
        document.removeEventListener('visibilitychange', hidden);
        removeEventListener('pagehide', hidden);
      },
    );
  }

  update(): void {
    const now = performance.now();
    if (!this.restored) {
      if (now > RESTORE_AFTER_MS) void this.restore();
      return;
    }
    if (room.connected || this.busy) return;
    if (now - this.clayAt > CLAY_EVERY_MS) {
      this.clayAt = now;
      void this.saveClay();
    } else if (this.dirty || now - this.objectsAt > OBJECTS_EVERY_MS) {
      this.objectsAt = now;
      this.saveObjects(this.dirty);
      this.dirty = false;
    }
  }

  private async restore(): Promise<void> {
    this.restored = true;
    this.busy = true;
    try {
      if (room.connected) return;
      const [clay, list] = await Promise.all([idbGet<SculptSnapshot>('autosave', 'clay'), idbGet<SavedCreation[]>('autosave', 'creations')]);
      let n = 0;
      if (clay?.actions?.length && clay.data) {
        this.sculpt.sculptClient.importState(clay);
        this.stats.restoredClay = true;
      }
      const here = new Set(this.objects.liveCreationIds());
      for (const s of Array.isArray(list) ? list : []) {
        if (s?.schemaVersion !== LIBRARY_SCHEMA || !Array.isArray(s.parts) || here.has(s.id)) continue;
        this.objects.restore(s, 'saved');
        n++;
      }
      this.saved = Array.isArray(list) ? list : [];
      this.stats.restoredObjects = n;
      this.lastClay = await this.sculpt.sculptClient.checksum();
      if (this.stats.restoredClay || n) {
        const what = [this.stats.restoredClay ? 'your clay' : '', n ? `${n} creation${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
        bus.emit('ui:toast', { text: `Welcome back: ${what} saved automatically` });
      }
    } catch (e) {
      console.warn('[autosave] could not restore', e);
    } finally {
      this.busy = false;
    }
  }

  /** Save now (the page is being hidden): the creations at once, the clay if it changed. */
  private async save(now = false): Promise<void> {
    if (!this.restored || room.connected) return;
    this.saveObjects(true);
    if (now) await this.saveClay();
  }

  private async saveClay(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const c = this.sculpt.sculptClient;
      const sum = await c.checksum();
      if (sum === this.lastClay) return;
      await idbSet('autosave', 'clay', await c.exportState());
      this.lastClay = sum;
      this.stats.clay++;
    } catch (e) {
      console.warn('[autosave] clay', e);
    } finally {
      this.busy = false;
    }
  }

  /** The loose creations; between changes only when something moved (writing meshes is not free). */
  private saveObjects(force: boolean): void {
    const prev = new Map(this.saved.map((s) => [s.id, s]));
    const list: SavedCreation[] = [];
    for (const id of this.objects.liveCreationIds()) {
      if (id.includes('#exp')) continue;
      // a creation whose material is still being built in keeps its last saved state
      const s = this.objects.serialize(id, false) ?? prev.get(id) ?? null;
      if (s && !s.pinned) list.push(s);
    }
    const sig = list.map((s) => `${s.id}:${s.pose.p.map((v) => v.toFixed(2)).join(',')}`).join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.saved = list;
    this.stats.objects++;
    void idbSet('autosave', 'creations', list).catch((e) => console.warn('[autosave] creations', e));
  }
  private sig = '';
}
