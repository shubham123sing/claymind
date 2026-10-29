/**
 * Typing a short text anywhere in the app, hands only (V6): in the headset the pinch keypad opens
 * in front of the player (no keyboard, no microphone); in the browser the normal prompt(). Used for
 * names (Library, Play Kit toys and Sets). The game agent keeps its own keypad beside its panel.
 *
 *   bus.emit('text:ask', { title: 'New name', initial: 'Toy 1', done: (text) => ... })
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { uiSounds } from '../audio/ui-sounds.js';
import { XR_TEXT_SCALE } from './canvas-panel.js';
import { KeypadPanel } from './keypad.js';

/** Closes by itself when nobody types for this long (ms). */
const IDLE_CLOSE_MS = 60_000;

export class TextEntrySystem extends createSystem({}) {
  private keypad = new KeypadPanel();
  private done: ((text: string) => void) | null = null;
  private initial = '';
  private lastTouch = 0;
  private eye = new Vector3();
  private fwd = new Vector3();
  private tip = new Vector3();

  init(): void {
    const m = this.keypad.mesh;
    m.visible = false;
    m.renderOrder = 27;
    (m.material as { depthTest: boolean }).depthTest = false;
    this.world.createTransformEntity(m);
    this.cleanupFuncs.push(bus.on('text:ask', (e) => this.ask(e.title, e.initial, e.done)));
  }

  private ask(title: string, initial: string, done: (text: string) => void): void {
    if (!input.xr) {
      if (typeof prompt !== 'function') return;
      const t = prompt(title, initial);
      if (t !== null && t.trim()) done(t.trim().slice(0, 40));
      return;
    }
    this.done = done;
    this.initial = initial;
    this.keypad.title = `${title} (now: ${initial})`;
    this.keypad.text = '';
    this.keypad.invalidate();
    this.place();
    this.keypad.mesh.visible = true;
    this.lastTouch = performance.now();
    uiSounds.tick();
  }

  /** In front of the eyes, a little low (a comfortable poke), facing them; set once when it opens. */
  private place(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.eye);
    cam.getWorldDirection(this.fwd).setY(0);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const m = this.keypad.mesh;
    m.scale.setScalar(XR_TEXT_SCALE);
    m.position.copy(this.eye).addScaledVector(this.fwd, 0.38);
    m.position.y -= 0.22;
    m.lookAt(this.eye);
  }

  private finish(ok: boolean): void {
    const text = this.keypad.text.trim();
    this.keypad.mesh.visible = false;
    const done = this.done;
    this.done = null;
    if (ok && done) done(text || this.initial);
    uiSounds.tick(2);
  }

  update(): void {
    if (!this.keypad.mesh.visible) return;
    const now = performance.now();
    if (!input.xr || now - this.lastTouch > IDLE_CLOSE_MS) return this.finish(false);
    const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
    const id = this.keypad.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, now);
    if (id) {
      this.lastTouch = now;
      uiSounds.tick();
      const r = this.keypad.press(id);
      if (r) this.finish(r === 'done');
    }
    this.keypad.draw();
  }
}
