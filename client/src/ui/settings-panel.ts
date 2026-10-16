/**
 * Settings (plan v4, section 7): accessibility toggles, the tutorial again, and
 * Reset (two taps: wipes the Library, the brain and the settings, then reloads).
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { setSetting, settings, Settings } from '../core/settings.js';
import { input } from '../platform/input/input-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { bindPanelMouse, CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';

const W = 760, H = 700;
const SIZE: [number, number] = [0.24, (0.24 * H) / W];

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'reducedMotion', label: 'Reduced motion', hint: 'no bobbing, no easing' },
  { key: 'highContrast', label: 'High contrast', hint: 'solid panels, white outlines' },
  { key: 'leftHanded', label: 'Left-handed', hint: 'left hand sculpts, right palm menu' },
  { key: 'oneHanded', label: 'One-handed menu', hint: 'menu stays beside the clay' },
  { key: 'sound', label: 'Sound', hint: 'all sounds on / off' },
];

class SettingsPanel extends CanvasPanel {
  resetArmed = false;
  constructor() {
    super([W, H], SIZE);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Settings', 32, 46);
    TOGGLES.forEach((t, i) => {
      const y = 96 + i * 92;
      const on = settings[t.key] as boolean, hover = this.hover === t.key;
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(20, y, W - 40, 80, 18);
      ctx.fill();
      add(20, y, W - 40, 80, t.key);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 30px system-ui, sans-serif';
      ctx.fillText(t.label, 44, y + 28);
      ctx.font = '500 21px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(244,241,236,0.65)';
      ctx.fillText(t.hint, 44, y + 58);
      // switch
      const sx = W - 140, sy = y + 22;
      ctx.fillStyle = on ? '#5fbf72' : settings.highContrast ? '#444' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(sx, sy, 92, 36, 18);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(on ? sx + 74 : sx + 18, sy + 18, 14, 0, Math.PI * 2);
      ctx.fill();
    });
    const by = H - 120;
    const bw = (W - 40 - 32) / 3;
    const btn = (i: number, label: string, id: string, accent?: string) => {
      add(20 + i * (bw + 16), by, bw, 76, id);
      ui.button(ctx, 20 + i * (bw + 16), by, bw, 76, label, { hover: this.hover === id, accent });
    };
    btn(0, 'Tutorial again', 'tutorial');
    btn(1, this.resetArmed ? 'Tap to confirm' : 'Reset everything', 'reset', this.resetArmed ? '#d9534f' : undefined);
    btn(2, 'Close', 'close');
  }
}

export class SettingsSystem extends createSystem({}) {
  private panel = new SettingsPanel();
  private tip = new Vector3();
  private v = new Vector3();
  private at = new Vector3();
  private toEye = new Vector3();

  init(): void {
    const m = this.panel.mesh;
    m.visible = false;
    m.renderOrder = 22;
    (m.material as { depthTest: boolean }).depthTest = false;
    this.world.createTransformEntity(m);
    this.cleanupFuncs.push(
      bus.on('settings:toggle', () => (m.visible ? this.close() : this.open())),
      bindPanelMouse(this.world, this.panel, (id) => this.press(id), () => input.xr),
    );
  }

  private open(): void {
    this.panel.resetArmed = false;
    this.panel.invalidate();
    this.place();
    this.panel.mesh.visible = true;
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
  }

  private place(): void {
    const m = this.panel.mesh;
    const eye = this.world.camera.getWorldPosition(this.v);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.at);
    const toEye = this.toEye.copy(eye).sub(at).setY(0).normalize();
    m.scale.setScalar(input.xr ? XR_TEXT_SCALE : 0.5);
    m.position.copy(at).addScaledVector(toEye, 0.14);
    m.position.y += input.xr ? 0.16 : 0.07;
    // desktop: right of the clay, clear of the toolbar on the left of the screen
    if (!input.xr) m.position.x += toEye.z * 0.06, m.position.z -= toEye.x * 0.06;
    m.lookAt(eye);
  }

  private press(id: string): void {
    const t = TOGGLES.find((x) => x.key === id);
    if (t) {
      setSetting(t.key, !settings[t.key] as never);
      uiSounds.tick(settings[t.key] ? 2 : 0);
    } else if (id === 'tutorial') {
      setSetting('tutorialDone', false);
      bus.emit('tutorial:start', {});
      this.close();
    } else if (id === 'reset') {
      if (!this.panel.resetArmed) {
        this.panel.resetArmed = true;
        bus.emit('ui:toast', { text: 'Tap again to erase your Library and settings' });
      } else void resetEverything();
    } else if (id === 'close') this.close();
    this.panel.invalidate();
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    this.place();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const id = this.panel.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, performance.now());
      if (id) this.press(id);
    }
    this.panel.draw();
  }
}

/** Erase the IndexedDB database (Library, brain, settings) and start fresh. */
async function resetEverything(): Promise<void> {
  bus.emit('ui:toast', { text: 'Resetting...' });
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase('claymind');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
    setTimeout(resolve, 2000);
  });
  location.reload();
}
