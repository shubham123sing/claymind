/**
 * Remove from scene / Clear scene: take placed objects off the table. Only the
 * copy in the room goes (its physics body, colliders, meshes and pin data); a
 * Library item is never deleted or changed, so it can be used again. Not
 * destructive, so no confirmation for one object, just a 5-second Undo.
 * Clear scene removes every object placed from the Library (Use / Edit) after
 * a confirming second press, also with Undo.
 * Wording: "Remove from scene" (this copy) vs "Delete from Library" (the saved
 * item, forever) vs "Delete this creation" (what is being made).
 */
import { createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import type { SavedCreation } from '../storage/library.js';
import { LibrarySystem, PLACED_SUFFIX } from './library.js';
import { offerUndo } from './undo-toast.js';

const CONFIRM_MS = 3000;

interface Removed {
  saved: SavedCreation;
  /** Library item this copy was editing (Edit), re-linked on Undo. */
  link: string | null;
}

export class SceneActionsSystem extends createSystem({}) {
  private clearArmedAt = -Infinity;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('scene:remove', (e) => this.removeOne(e.creationId)),
      bus.on('scene:clear', () => this.clear()),
    );
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private get library() {
    return this.world.getSystem(LibrarySystem)!;
  }

  private take(id: string): Removed | null {
    const link = this.library.editLinkOf(id);
    const saved = this.objects.deleteCreation(id); // frees body, colliders, meshes; 'creation:removed' drops pin data
    return saved ? { saved, link } : null;
  }

  private putBack(r: Removed): void {
    this.objects.restore(r.saved, 'saved');
    if (r.link) this.library.relink(r.saved.id, r.link);
    if (r.saved.pinned) bus.emit('creation:changed', { creationId: r.saved.id }); // pin kept again after a reload
  }

  private removeOne(creationId?: string): void {
    const id = creationId ?? this.objects.focusTarget()?.creationId;
    if (!id) {
      bus.emit('ui:toast', { text: 'Touch an object first, then Remove from scene' });
      return;
    }
    const name = this.objects.creationById(id)?.name ?? 'it';
    const r = this.take(id);
    if (!r) {
      bus.emit('ui:toast', { text: 'Cannot remove it right now' });
      return;
    }
    offerUndo(`Removed "${name}" from scene`, () => {
      this.putBack(r);
      this.objects.focusOn(id);
    }, input.xr);
  }

  private clear(): void {
    const ids = this.objects.liveCreationIds().filter((id) => id.endsWith(PLACED_SUFFIX));
    if (!ids.length) {
      bus.emit('ui:toast', { text: 'No Library objects in the scene' });
      return;
    }
    const now = performance.now();
    if (now - this.clearArmedAt > CONFIRM_MS) {
      this.clearArmedAt = now;
      bus.emit('ui:toast', { text: `Clear scene: remove ${ids.length} Library object(s)? Press again (the Library keeps them)` });
      return;
    }
    this.clearArmedAt = -Infinity;
    const removed = ids.map((id) => this.take(id)).filter((r): r is Removed => r !== null);
    offerUndo(`Cleared ${removed.length} object(s) from scene`, () => removed.forEach((r) => this.putBack(r)), input.xr);
  }
}
