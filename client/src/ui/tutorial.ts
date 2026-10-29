/**
 * First five minutes (V6, 4.1): a small card above the clay walks a new player along the hero
 * path with hands only, in about a minute: shape the clay -> bring it to life -> make it a game
 * (the agent looks at it and proposes one game, with why) -> play it, then a success moment and
 * where to go next. Steps 2 and 3 are one tap on the card itself (the same as the palm menu).
 * Each step advances when the player does it; Skip any time. Shown once (settings.tutorialDone);
 * the menu's Help (?) and Settings -> "Tutorial again" show it again.
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { AppEvents, bus } from '../core/event-bus.js';
import { setSetting, settings, settingsReady } from '../core/settings.js';
import { input } from '../platform/input/input-system.js';
import { GameAgentSystem } from '../game-agent/game-agent-system.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { SettingsSystem } from './settings-panel.js';
import { bindPanelMouse, CanvasPanel, ui, XR_TEXT_SCALE } from './canvas-panel.js';

const W = 900, H = 330;
const SIZE: [number, number] = [0.26, (0.26 * H) / W];

interface Step {
  xr: string;
  desktop: string;
  /** the event that completes it */
  on: keyof AppEvents;
  ok?: (e: never) => boolean;
  /** a one-tap button on the card for this step */
  button?: { label: string; id: string };
  /** the big gesture picture */
  pinch?: boolean;
}

export const STEPS: Step[] = [
  { xr: 'Pinch the clay and pull to shape it', desktop: 'Drag the clay to shape it', on: 'clay:touched', pinch: true },
  { xr: 'Bring it to life: tap the button (or palm up -> Bring to life)', desktop: 'Bring it to life: press the button (or Enter)', on: 'creation:baked', button: { label: 'Bring to life', id: 'life' } },
  { xr: 'Now make it a game: the agent looks at what you made', desktop: 'Now make it a game: the agent looks at what you made', on: 'playkit:game', ok: ((e: { kind: string }) => e.kind === 'start') as never, button: { label: 'Make it a game', id: 'game' } },
  { xr: 'Play! Pinch a ball, swing and let go', desktop: 'Play! Drag a ball and let go to throw it', on: 'playkit:over' },
];

class CoachPanel extends CanvasPanel {
  step = 0;
  doneText = '';
  constructor() {
    super([W, H], SIZE);
  }

  /** Two fingertips meeting, and an arrow pulling away: "pinch and pull". */
  private pinch(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.strokeStyle = '#e2733b';
    ctx.fillStyle = '#e2733b';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y - 22, 16, 0, Math.PI * 2);
    ctx.arc(x, y + 22, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 40, y);
    ctx.lineTo(x + 100, y);
    ctx.moveTo(x + 82, y - 18);
    ctx.lineTo(x + 100, y);
    ctx.lineTo(x + 82, y + 18);
    ctx.stroke();
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    const done = !!this.doneText;
    // progress dots
    STEPS.forEach((_, i) => {
      ctx.fillStyle = i < this.step || done ? '#5fbf72' : i === this.step ? '#e2733b' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(40 + i * 30, 40, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(done ? 'You did it' : `Step ${this.step + 1} of ${STEPS.length}`, 180, 41);
    const s = STEPS[this.step];
    if (done) {
      // the success moment: a green card, stars, the time, and where to go next
      ctx.fillStyle = 'rgba(95,191,114,0.16)';
      ctx.beginPath();
      ctx.roundRect(16, 70, W - 32, H - 86, 24);
      ctx.fill();
      ctx.fillStyle = '#f0b429';
      ctx.font = '700 44px system-ui, sans-serif';
      ctx.fillText('★ ★ ★', W - 230, 41);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '700 40px system-ui, sans-serif';
      ui.wrap(ctx, this.doneText, 36, 118, W - 72, 48, 2);
      ctx.fillStyle = 'rgba(244,241,236,0.85)';
      ctx.font = '500 27px system-ui, sans-serif';
      ui.wrap(ctx, 'Next: Colour & Material, Keep it in your Library, the Play Kit, or a Room with a friend. The ? in the menu shows this again.', 36, 206, W - 290, 34, 3);
    } else {
      const x0 = s.pinch ? 170 : 32;
      if (s.pinch) this.pinch(ctx, 50, 150);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '700 42px system-ui, sans-serif';
      ui.wrap(ctx, input.xr ? s.xr : s.desktop, x0, 120, W - x0 - 32, 50, 2);
      if (s.button) {
        add(32, H - 108, 420, 84, s.button.id);
        ui.button(ctx, 32, H - 108, 420, 84, s.button.label, { hover: this.hover === s.button.id, accent: '#5fbf72' });
      }
    }
    const id = done ? 'close' : 'skip';
    add(W - 200, H - 108, 170, 84, id);
    ui.button(ctx, W - 200, H - 108, 170, 84, done ? 'OK' : 'Skip', { hover: this.hover === id });
  }
}

export class TutorialSystem extends createSystem({}) {
  private panel = new CoachPanel();
  private active = false;
  private startedAt = 0;
  private offs: (() => void)[] = [];
  private v = new Vector3();
  private at = new Vector3();
  private side = new Vector3();

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
        this.advance(e as unknown as AppEvents['playkit:over']);
      }) as never),
    );
  }

  /** `over`: the last step's event (the game's result and score). */
  private advance(over?: AppEvents['playkit:over']): void {
    if (this.panel.step + 1 < STEPS.length) uiSounds.chime();
    if (this.panel.step + 1 < STEPS.length) {
      this.panel.step++;
      this.listen();
    } else {
      const sec = Math.round((performance.now() - this.startedAt) / 1000);
      const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      this.panel.doneText = over?.result === 'win' ? `You won! A game from clay, made and played in ${time}.` : `You made a game from clay in ${time}! You scored ${over?.score ?? 0}.`;
      uiSounds.fanfare();
      this.finish(false);
      return this.panel.invalidate();
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
      bus.emit('ui:toast', { text: 'Skipped: the ? in the menu shows it again' });
    } else if (id === 'close') this.panel.mesh.visible = false;
    // one tap does the step (the same as the palm menu)
    else if (id === 'life') void this.world.getSystem(SculptSystem)!.bringToLife();
    else if (id === 'game') bus.emit('gameagent:make', {});
  }

  private drawnForXr = false;

  /** Hidden while a Play Kit game or Set is on the table (the clay is away); back after. */
  private awayForPlay = false;

  update(): void {
    const m = this.panel.mesh;
    // the "Play!" step and the success card stay while the game is on the table
    // the game agent's panel and Settings are read on their own (the card would show through them)
    const agentOpen = (this.world.getSystem(GameAgentSystem)?.panelOpen ?? false) || (this.world.getSystem(SettingsSystem)?.panelOpen ?? false);
    const away = agentOpen || (this.world.getSystem(SculptSystem)!.suspended && !(this.active && this.panel.step === STEPS.length - 1) && !this.panel.doneText);
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
    if (this.world.getSystem(PlayKitSystem)?.scoreboardUp) {
      // the game's scoreboard stands right of the play area: the card moves to the left, no overlap
      const side = this.side.set(at.z - eye.z, 0, eye.x - at.x).normalize();
      m.position.addScaledVector(side, input.xr ? 0.2 : 0.13);
    }
    m.lookAt(eye);
    if (input.xr) {
      const id = this.panel.pokeHands(input.both, performance.now());
      if (id) this.press(id);
    }
    m.updateMatrixWorld();
    this.panel.draw();
  }
}
