/**
 * First five minutes (plan v4, section 7): a small card above the clay walks
 * through shape -> colour / paint -> bring to life -> material -> pin. Each step
 * advances when the player does it (no text wall, no quiz); Skip any time.
 * Shown once (settings.tutorialDone); Settings -> "Tutorial again".
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { AppEvents, bus } from '../core/event-bus.js';
import { setSetting, settings, settingsReady } from '../core/settings.js';
import { input } from '../platform/input/input-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { bindPanelMouse, CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';

const W = 900, H = 250;
const SIZE: [number, number] = [0.26, (0.26 * H) / W];

interface Step {
  xr: string;
  desktop: string;
  /** the event that completes it */
  on: keyof AppEvents;
  ok?: (e: never) => boolean;
}

const STEPS: Step[] = [
  { xr: 'Pinch the clay and pull to shape it', desktop: 'Drag the clay to shape it', on: 'clay:touched' },
  { xr: 'Palm up -> Color: pick a colour, then Paint on the clay', desktop: 'Color (C): pick a colour, then Paint (5) on the clay', on: 'clay:painted' },
  { xr: 'Palm up -> Bring to life', desktop: 'Bring to life (Enter)', on: 'creation:baked' },
  { xr: 'Touch it, then Material: what is it made of?', desktop: 'Click it, then Material (T): what is it made of?', on: 'object:material-set', ok: ((e: { by: string }) => e.by === 'user') as never },
  { xr: 'Put it on the table and press Pin', desktop: 'Drag it onto the table, then Pin (P)', on: 'object:pinned' },
];

class CoachPanel extends CanvasPanel {
  step = 0;
  doneText = '';
  constructor() {
    super([W, H], SIZE);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    // progress dots
    STEPS.forEach((_, i) => {
      ctx.fillStyle = i < this.step || this.doneText ? '#5fbf72' : i === this.step ? '#e2733b' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(40 + i * 30, 40, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(this.doneText ? 'Done' : `Step ${this.step + 1} of ${STEPS.length}`, 200, 41);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 40px system-ui, sans-serif';
    const s = STEPS[this.step];
    ui.wrap(ctx, this.doneText || (input.xr ? s.xr : s.desktop), 32, 118, W - 260, 48, 2);
    const id = this.doneText ? 'close' : 'skip';
    add(W - 200, H - 110, 170, 80, id);
    ui.button(ctx, W - 200, H - 110, 170, 80, this.doneText ? 'OK' : 'Skip', { hover: this.hover === id });
  }
}

export class CoachSystem extends createSystem({}) {
  private panel = new CoachPanel();
  private active = false;
  private startedAt = 0;
  private offs: (() => void)[] = [];
  private tip = new Vector3();
  private v = new Vector3();
  private at = new Vector3();

  init(): void {
    const m = this.panel.mesh;
    m.visible = false;
    m.renderOrder = 21;
    (m.material as { depthTest: boolean }).depthTest = false;
    this.world.createTransformEntity(m);
    this.cleanupFuncs.push(
      bus.on('tutorial:start', () => this.start()),
      bindPanelMouse(this.world, this.panel, (id) => this.press(id), () => input.xr),
      () => this.offs.forEach((f) => f()),
    );
    void settingsReady.then(() => {
      if (!settings.tutorialDone) setTimeout(() => this.start(), 1200);
    });
  }

  private start(): void {
    this.active = true;
    this.panel.step = 0;
    this.panel.doneText = '';
    this.startedAt = performance.now();
    this.listen();
    this.panel.mesh.visible = true;
    this.panel.invalidate();
  }

  private listen(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
    const s = STEPS[this.panel.step];
    this.offs.push(
      bus.on(s.on, ((e: never) => {
        if (!this.active || (s.ok && !s.ok(e))) return;
        this.advance();
      }) as never),
    );
  }

  private advance(): void {
    uiSounds.chime();
    if (this.panel.step + 1 < STEPS.length) {
      this.panel.step++;
      this.listen();
    } else {
      const sec = Math.round((performance.now() - this.startedAt) / 1000);
      this.panel.doneText = `Done in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}! It is saved in your Library.`;
      this.finish(false);
    }
    this.panel.invalidate();
  }

  private finish(hide: boolean): void {
    this.active = false;
    this.offs.forEach((f) => f());
    this.offs = [];
    setSetting('tutorialDone', true);
    if (hide) this.panel.mesh.visible = false;
  }

  private press(id: string): void {
    uiSounds.tick();
    if (id === 'skip') {
      this.finish(true);
      bus.emit('ui:toast', { text: 'Tutorial skipped (Settings -> Tutorial again)' });
    } else if (id === 'close') this.panel.mesh.visible = false;
  }

  private drawnForXr = false;

  /** Hidden while a Play Kit game or Set is on the table (the clay is away); back after. */
  private awayForPlay = false;

  update(): void {
    const m = this.panel.mesh;
    const away = this.world.getSystem(SculptSystem)!.suspended;
    if (away && m.visible) {
      m.visible = false;
      this.awayForPlay = true;
    } else if (!away && this.awayForPlay) {
      m.visible = true;
      this.awayForPlay = false;
    }
    if (!m.visible) return;
    // above the clay, facing the viewer
    const eye = this.world.camera.getWorldPosition(this.v);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.at);
    if (input.xr !== this.drawnForXr) {
      // headset and browser have different wording: redraw when XR starts or ends
      this.drawnForXr = input.xr;
      this.panel.invalidate();
    }
    m.scale.setScalar(input.xr ? XR_TEXT_SCALE : 0.6);
    m.position.copy(at);
    m.position.y += input.xr ? 0.2 : 0.15; // above the clay's size label
    m.lookAt(eye);
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const id = this.panel.poke(h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null, performance.now());
      if (id) this.press(id);
    }
    m.updateMatrixWorld();
    this.panel.draw();
  }
}
