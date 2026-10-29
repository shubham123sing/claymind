/**
 * Seated height (V6 gap 2). The virtual table stands at a fixed height; a seated player on a low or
 * high chair (or standing) would find it at the wrong height. Instead of moving the table and
 * everything on it, the player's view moves: the XR reference space gets a vertical offset so the
 * eyes are about 45 cm above the table top, measured when the session starts and on Recenter.
 * Bring to life -> Table higher / lower nudges it by 3 cm (kept in Settings).
 * Not in mixed reality (the real room must stay where it is), and not on a real table plane.
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { setSetting, settings } from '../core/settings.js';
import { surface } from './surface/surface-system.js';
import { xrOrigin } from './input/hand-state.js';
import { passthroughOn } from './xr-mode.js';

/** Eyes above the table top for a seated player at a desk (m). */
export const EYE_ABOVE_TABLE = 0.45;
/** Smaller differences are left alone (a normal chair needs no change). */
export const DEAD_BAND = 0.05;
/** The view moves at most this far up or down (m). */
export const MAX_SHIFT = 0.6;
/** One press of Table higher / lower (m). */
export const NUDGE = 0.03;

/**
 * How far (m) to raise the view so the eyes sit EYE_ABOVE_TABLE over the table, plus the player's own
 * nudge (`adjust`: positive = table higher, so the view goes down). 0 inside the dead band.
 */
export function viewShift(headY: number, tableTop: number, adjust: number): number {
  let d = tableTop + EYE_ABOVE_TABLE - headY;
  if (Math.abs(d) < DEAD_BAND) d = 0;
  return Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, d - adjust));
}

export class SeatedHeightSystem extends createSystem({}) {
  /** The view's current vertical shift (m, QA). */
  shift = 0;
  private started = false;
  private head = new Vector3();
  /** Calibrate once the head has been tracked for a moment (ms since the session began). */
  private due = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        if (s === 'non-immersive') {
          this.started = false;
          this.set(0);
        } else if (!this.started) {
          this.started = true;
          this.due = performance.now() + 1000;
        }
      }),
      bus.on('view:recenter', () => this.calibrate()),
      bus.on('table:nudge', (e) => {
        setSetting('tableAdjust', Math.max(-0.3, Math.min(0.3, settings.tableAdjust + e.delta)));
        this.calibrate();
        bus.emit('ui:toast', { text: e.delta > 0 ? 'Table a little higher' : 'Table a little lower' });
      }),
    );
  }

  private usable(): boolean {
    return !!this.world.session && !passthroughOn(this.world.renderer) && !surface.real;
  }

  /** Measure the head (without the current shift) and set the shift for it. */
  calibrate(): void {
    if (!this.usable()) return;
    const headY = this.world.camera.getWorldPosition(this.head).y - this.shift;
    const next = viewShift(headY, surface.topY, settings.tableAdjust);
    if (Math.abs(next - this.shift) >= 0.005) this.set(next);
  }

  private set(y: number): void {
    this.shift = y;
    xrOrigin.y = y;
    this.world.player.position.y = y;
  }

  update(): void {
    if (this.due && performance.now() >= this.due) {
      this.due = 0;
      this.calibrate();
    }
  }
}
