/**
 * Settings (plan v4, section 7): accessibility toggles, the tutorial again, About (V6: how to
 * play in short, today's challenge, what needs the internet, the build id) and
 * Reset (two taps: wipes the Library, the brain and the settings, then reloads).
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { setSetting, settings, Settings } from '../core/settings.js';
import { input } from '../platform/input/input-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { DailyChallengeSystem } from './daily-challenge-system.js';
import { bindPanelMouse, CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';

const W = 760, H = 990;
/** The commit and date of this build (vite.config.ts); 'dev' in unit tests. */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const SIZE: [number, number] = [0.24, (0.24 * H) / W];

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'reducedMotion', label: 'Reduced motion', hint: 'no bobbing, no easing' },
  { key: 'highContrast', label: 'High contrast', hint: 'solid panels, white outlines' },
  { key: 'leftHanded', label: 'Left-handed', hint: 'left hand sculpts, right palm menu' },
  { key: 'oneHanded', label: 'One-handed menu', hint: 'menu stays beside the clay' },
  { key: 'largeText', label: 'Large text', hint: 'bigger panels and text in the headset' },
  { key: 'sound', label: 'Sound', hint: 'all sounds on / off' },
  { key: 'performanceMode', label: 'Performance mode', hint: 'simpler effects, steadier frame rate' },
  { key: 'vision', label: 'Vision check (online)', hint: 'pictures of new Play Kit toys go to Groq; their terms apply' },
];

/** About: what the player needs in a few lines (hands only, seated). */
const ABOUT = [
  'Palm up: the menu. Poke a button with a fingertip.',
  'Pinch on the clay to shape it; pinch an object to pick it up.',
  'Bring to life makes it real; throw it, pin it, play with it.',
  'Play -> Make it a game: the agent proposes a game.',
  'Everything works offline except the game agent and rooms.',
  'Your work saves itself; Keep -> Library for good.',
];

class SettingsPanel extends CanvasPanel {
  resetArmed = false;
  page: 'settings' | 'about' = 'settings';
  /** Today's challenge line for About. */
  daily = '';
  constructor() {
    super([W, H], SIZE);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.page === 'about' ? 'About ClayMind' : 'Settings', 32, 46);
    const by = H - 130;
    const bw = (W - 40 - 48) / 4;
    const btn = (i: number, label: string, id: string, accent?: string) => {
      add(20 + i * (bw + 16), by, bw, 76, id);
      ui.button(ctx, 20 + i * (bw + 16), by, bw, 76, label, { hover: this.hover === id, accent });
    };
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.55)';
    ctx.fillText(`Build ${BUILD_ID}`, 32, H - 28);
    if (this.page === 'about') {
      ctx.font = '500 27px system-ui, sans-serif';
      ABOUT.forEach((line, i) => {
        ctx.fillStyle = '#f4f1ec';
        ctx.fillText(line, 36, 120 + i * 70, W - 72);
      });
      ctx.fillStyle = '#f0b429';
      ctx.font = '600 26px system-ui, sans-serif';
      wrap(ctx, this.daily, 36, 120 + ABOUT.length * 70 + 10, W - 72, 36);
      btn(0, 'Tutorial again', 'tutorial');
      btn(2, 'Back', 'back');
      btn(3, 'Close', 'close');
      return;
    }
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
      ctx.fillText(t.hint, 44, y + 58, W - 220);
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
    btn(0, 'Tutorial again', 'tutorial');
    btn(1, 'About', 'about');
    btn(2, this.resetArmed ? 'Tap to confirm' : 'Reset all', 'reset', this.resetArmed ? '#d9534f' : undefined);
    btn(3, 'Close', 'close');
  }
}

/** Word-wrapped text, at most two lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number): void {
  let line = '', row = 0;
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w && line) {
      ctx.fillText(line, x, y + row++ * lh, w);
      line = word;
      if (row === 2) return;
    } else line = next;
  }
  ctx.fillText(line, x, y + row * lh, w);
}

export class SettingsSystem extends createSystem({}) {
  private panel = new SettingsPanel();
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

  /** Settings is on screen (the tutorial card steps aside: no overlap). */
  get panelOpen(): boolean {
    return this.panel.mesh.visible;
  }

  private open(): void {
    this.panel.resetArmed = false;
    this.panel.page = 'settings';
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
    } else if (id === 'about') {
      this.panel.page = 'about';
      this.panel.daily = this.world.getSystem(DailyChallengeSystem)?.line() ?? '';
    } else if (id === 'back') this.panel.page = 'settings';
    else if (id === 'close') this.close();
    this.panel.invalidate();
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    this.place();
    if (input.xr) {
      const id = this.panel.pokeHands(input.both, performance.now());
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
