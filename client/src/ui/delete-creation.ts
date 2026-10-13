/**
 * "Delete this creation": removes what the player is making now, the object
 * they touched last or else the clay. Two presses within 3 s confirm (the first
 * one says what will go); afterwards a 5-second Undo brings it back.
 */
import { createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { ObjectSystem } from '../objects/object-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { offerUndo } from './undo-toast.js';

const CONFIRM_MS = 3000;

export class DeleteSystem extends createSystem({}) {
  private armedAt = -Infinity;
  private armedId = '';

  init(): void {
    this.cleanupFuncs.push(bus.on('creation:delete', () => this.press()));
  }

  /** The object last touched (if touched after the clay), else the clay. */
  private target(): { id: string; name: string } {
    const objects = this.world.getSystem(ObjectSystem)!;
    const sculpt = this.world.getSystem(SculptSystem)!;
    const t = objects.focusTarget();
    if (t && objects.lastObjectTouch >= sculpt.lastClayTouch) {
      return { id: t.creationId, name: objects.creationById(t.creationId)?.name ?? 'this creation' };
    }
    return { id: 'clay', name: 'the clay' };
  }

  private press(): void {
    const now = performance.now();
    const { id, name } = this.target();
    if (now - this.armedAt > CONFIRM_MS || id !== this.armedId) {
      this.armedAt = now;
      this.armedId = id;
      bus.emit('ui:toast', { text: `Delete ${name}? Press Delete again to confirm`, color: '#d9534f' });
      return;
    }
    this.armedAt = -Infinity;
    const xr = input.xr;
    if (id === 'clay') {
      const sculpt = this.world.getSystem(SculptSystem)!;
      if (!sculpt.clearClay()) {
        bus.emit('ui:toast', { text: 'Busy bringing it to life, try again' });
        return;
      }
      offerUndo('Clay deleted (fresh lump)', () => sculpt.undoClear(), xr);
      return;
    }
    const objects = this.world.getSystem(ObjectSystem)!;
    const saved = objects.deleteCreation(id);
    if (!saved) {
      bus.emit('ui:toast', { text: 'Cannot delete it right now' });
      return;
    }
    offerUndo(`Deleted ${name}`, () => {
      bus.emit('ui:toast', { text: objects.restore(saved, 'saved') });
      objects.focusOn(saved.id); // it is the current creation again
    }, xr);
  }
}
