/**
 * "Ask AI" (Update 2, Step 3): the optional agent features inside the game.
 * - Make a game: game cards, Surprise me, a typed name, or the player's own rules (number
 *   cards + typed words); the backend's answer becomes a preview (Play / Adjust / Cancel);
 *   Adjust is a rules card checked again by the Referee here before playing.
 * - Teach me to build X: the Coach's steps one at a time; Check my work measures the
 *   current creation (or the clay) and gives one specific fix.
 * - Help: the Helper sees what the player is doing and offers one safe, undoable fix.
 * Typing: prompt() in the browser, the pinch keypad in the headset (no voice input).
 * Offline: one plain line, and the built-in games keep working.
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { measure } from '../playkit/kit-store.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import { templateById } from '../playkit/templates.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { XR_TEXT_SCALE } from '../ui/canvas-panel.js';
import { applyNumbers, numbersOf, rulesInWords } from './adjust.js';
import { helperApi, OFFLINE, OfflineError, type GameAnswer } from './helper-client.js';
import { HelperPanel, RULE_LIMITS, type RuleNumbers } from './helper-panel.js';
import { KeypadPanel } from './keypad.js';

const IDLE_CLOSE_MS = 90000;

export class HelperSystem extends createSystem({}) {
  private panel = new HelperPanel();
  private keypad = new KeypadPanel();
  private onTyped: ((text: string) => void) | null = null;
  private history: HelperPanel['view'][] = [];
  private openedAt = 0;
  private busy = false;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private v = new Vector3();
  private v2 = new Vector3();
  private tip = new Vector3();
  private lastToast = '';

  init(): void {
    for (const [m, order] of [[this.panel.mesh, 24], [this.keypad.mesh, 26]] as const) {
      m.visible = false;
      m.renderOrder = order;
      (m.material as { depthTest: boolean }).depthTest = false;
      this.world.createTransformEntity(m);
    }
    this.cleanupFuncs.push(
      bus.on('helper:toggle', () => (this.panel.mesh.visible ? this.close() : this.open())),
      bus.on('ui:toast', (e) => (this.lastToast = e.text)),
    );
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
  }

  private get kit() {
    return this.world.getSystem(PlayKitSystem)!;
  }

  // ---------- views ----------

  private go(view: HelperPanel['view']): void {
    if (this.panel.view !== view && this.panel.view !== 'thinking') this.history.push(this.panel.view);
    this.panel.view = view;
    this.panel.invalidate();
  }

  private back(): void {
    this.panel.view = this.history.pop() ?? 'home';
    this.panel.problems = [];
    this.panel.invalidate();
  }

  private open(): void {
    this.history = [];
    this.panel.view = 'home';
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    this.panel.online = null;
    this.panel.invalidate();
    void helperApi.online().then((ok) => {
      this.panel.online = ok;
      this.panel.invalidate();
    });
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
    this.keypad.mesh.visible = false;
    this.onTyped = null;
  }

  private say(message: string): void {
    this.panel.message = message;
    this.go('message');
  }

  /** Run a backend call with the thinking view; offline -> one plain line. */
  private async run<T>(status: string, job: () => Promise<T>): Promise<T | null> {
    if (this.busy) return null;
    this.busy = true;
    this.panel.status = status;
    this.go('thinking');
    try {
      return await job();
    } catch (e) {
      this.panel.online = e instanceof OfflineError && e.message === OFFLINE ? false : this.panel.online;
      this.panel.view = this.history.pop() ?? 'home';
      this.say(e instanceof Error ? e.message : OFFLINE);
      return null;
    } finally {
      this.busy = false;
      this.panel.invalidate();
    }
  }

  // ---------- typing ----------

  /** Ask for text: `fallback` is used when nothing is typed (OK / Done); Cancel does nothing. */
  private type(title: string, done: (text: string) => void, fallback = ''): void {
    this.typedFallback = fallback;
    if (!input.xr && typeof prompt === 'function') {
      const t = prompt(title, fallback);
      if (t !== null && (t.trim() || fallback)) done((t.trim() || fallback).slice(0, 120));
      return;
    }
    this.keypad.title = title;
    this.keypad.text = '';
    this.keypad.mesh.visible = true;
    this.keypad.invalidate();
    this.onTyped = done;
  }

  private keypadPress(id: string): void {
    const r = this.keypad.press(id);
    uiSounds.tick();
    if (!r) return;
    this.keypad.mesh.visible = false;
    const done = this.onTyped;
    this.onTyped = null;
    const text = this.keypad.text.trim() || this.typedFallback;
    if (r === 'done' && done && text) done(text);
  }
  private typedFallback = '';

  // ---------- make a game ----------

  private async askGame(req: { name?: string; rules?: string; rulesUnknown?: boolean; surprise?: boolean }): Promise<void> {
    const status = req.rules ? 'Using your rules…' : req.rulesUnknown ? 'Looking up the rules…' : 'Choosing a game…';
    const answer = await this.run(status, () => helperApi.game(req, [...this.kit.kitItems()]));
    if (!answer) return;
    this.showPreview(answer);
  }

  private specOf(a: GameAnswer) {
    return a.spec ?? (a.templateId ? templateById(a.templateId) ?? null : null);
  }

  private showPreview(a: GameAnswer): void {
    const spec = this.specOf(a);
    if (!spec) return this.say("I couldn't make that game. The built-in games are in Play Kit -> Games.");
    this.panel.answer = a;
    this.panel.uses = this.kit.usesFor(spec);
    this.panel.view = 'preview';
    this.panel.invalidate();
  }

  private playGame(spec = this.panel.answer && this.specOf(this.panel.answer)): void {
    if (!spec) return;
    const problems = this.kit.playSpec(spec);
    if (problems.length) {
      this.panel.problems = problems;
      return this.say(`That game is not safe to play: ${problems[0]}`);
    }
    this.close();
  }

  private step(k: keyof RuleNumbers, d: number): void {
    const [lo, hi, stepSize] = RULE_LIMITS[k];
    this.panel.numbers[k] = Math.max(lo, Math.min(hi, this.panel.numbers[k] + d * stepSize));
    this.panel.problems = [];
  }

  // ---------- teach ----------

  private async teach(goal: string): Promise<void> {
    const g = await this.run(`Planning how to build a ${goal.toLowerCase()}…`, () => helperApi.guide(goal));
    if (!g) return;
    if (!g.steps.length) return this.say(OFFLINE);
    this.panel.guideTitle = g.title;
    this.panel.steps = g.steps;
    this.panel.stepIndex = 0;
    this.panel.checkMessage = '';
    this.panel.view = 'guide';
    this.panel.invalidate();
  }

  /** The creation being worked on: the object touched last, else the clay. */
  private currentStats(): { sizeCm: number[]; materials: string[] } | null {
    const objects = this.world.getSystem(ObjectSystem)!, sculpt = this.world.getSystem(SculptSystem)!;
    const t = objects.focusTarget();
    if (t && objects.lastObjectTouch >= sculpt.lastClayTouch) {
      const s = objects.serialize(t.creationId);
      if (s) {
        const st = measure(s);
        return { sizeCm: st.sizeCm, materials: st.materials };
      }
    }
    const clay = sculpt.claySizeCm();
    return clay ? { sizeCm: clay, materials: ['clay'] } : null;
  }

  private async check(): Promise<void> {
    const step = this.panel.steps[this.panel.stepIndex], st = this.currentStats();
    if (!step || !st) return;
    try {
      const r = await helperApi.check(step, st.sizeCm, st.materials);
      this.panel.checkMessage = r.ok ? r.message : `${r.message}${r.fix ? ` Fix: ${r.fix}.` : ''}`;
    } catch (e) {
      this.panel.checkMessage = e instanceof Error ? e.message : OFFLINE;
    }
    this.panel.invalidate();
  }

  // ---------- help ----------

  private context(): Record<string, unknown> {
    const objects = this.world.getSystem(ObjectSystem)!, sculpt = this.world.getSystem(SculptSystem)!;
    const t = objects.focusTarget();
    return {
      tool: sculpt.toolId,
      selected: t ? { name: objects.creationById(t.creationId)?.name, material: t.materialId } : null,
      lastMessage: this.lastToast.slice(0, 120),
      playKit: this.kit.playMode, game: this.kit.gameName,
      headset: input.xr,
    };
  }

  private async help(): Promise<void> {
    this.panel.helpReply = '';
    this.panel.fix = 'none';
    const a = await this.run('Looking at what you are doing…', () => helperApi.ask("I'm stuck, what should I do?", this.context(), [...this.kit.kitItems()]));
    if (!a) return;
    this.panel.helpReply = a.reply;
    this.panel.fix = a.fix ?? 'none';
    this.panel.view = 'help';
    this.panel.invalidate();
  }

  /** Only safe, undoable actions. */
  private doFix(): void {
    const sculpt = this.world.getSystem(SculptSystem)!;
    switch (this.panel.fix) {
      case 'undo': sculpt.undoStep(); break;
      case 'bring_to_life': void sculpt.bringToLife(); break;
      case 'open_material': bus.emit('material:toggle', {}); break;
      case 'open_color': bus.emit('color:toggle', {}); break;
      case 'reset_game': this.kit.reset(); break;
      case 'end_game': this.kit.end(); break;
    }
    this.close();
  }

  // ---------- input ----------

  private press(id: string): void {
    const p = this.panel;
    this.openedAt = performance.now();
    uiSounds.tick();
    if (id === 'close') return this.close();
    if (id === 'back') return this.back();
    if (id === 'activity') {
      p.showActivity = !p.showActivity;
      if (p.showActivity) void helperApi.trace().then((t) => {
        p.activity = t.calls.map((c) => `${c.agent} · ${c.model} · ${c.ms} ms${c.cached ? ' · cached' : ''}${c.ok ? '' : ' · failed'}`);
        p.invalidate();
      }).catch(() => (p.activity = ['(offline)']));
    } else if (id === 'home:games') this.go('games');
    else if (id === 'home:teach') this.go('teach');
    else if (id === 'home:help') void this.help();
    else if (id === 'game:Surprise me') void this.askGame({ surprise: true });
    else if (id.startsWith('game:') && !['game:type', 'game:rules', 'game:lookup'].includes(id)) void this.askGame({ name: id.slice(5) });
    else if (id === 'game:type') this.type('Which game?', (name) => void this.askGame({ name }));
    else if (id === 'game:lookup') this.type("Which game? I'll look up the rules", (name) => void this.askGame({ name, rulesUnknown: true }));
    else if (id === 'game:rules') {
      p.numbers = { players: 2, maxTurns: 3, shotsPerTurn: 1, target: 0, timerSec: 0 };
      p.ruleText = '';
      this.go('rules');
    } else if (id === 'rules:type') this.type('Your rules, in your own words', (t) => ((p.ruleText = t), p.invalidate()));
    else if (id === 'rules:send') {
      const rules = rulesInWords(p.numbers, p.ruleText);
      this.type('A name for your game', (name) => void this.askGame({ name, rules }), 'My game');
    } else if (id.startsWith('num:')) {
      const [, k, d] = id.split(':');
      this.step(k as keyof RuleNumbers, Number(d));
    } else if (id === 'preview:play') this.playGame();
    else if (id === 'preview:adjust' && p.answer) {
      const spec = this.specOf(p.answer);
      if (spec) {
        p.numbers = numbersOf(spec);
        this.go('adjust');
      }
    } else if (id === 'adjust:play' && p.answer) {
      const base = this.specOf(p.answer);
      if (!base) return;
      const { spec, problems } = applyNumbers(base, p.numbers);
      p.problems = problems;
      if (!problems.length) this.playGame(spec);
    } else if (id.startsWith('build:') && id !== 'build:type') void this.teach(id.slice(6));
    else if (id === 'build:type') this.type('What do you want to build?', (goal) => void this.teach(goal));
    else if (id === 'step:prev' || id === 'step:next') {
      p.stepIndex = Math.max(0, Math.min(p.steps.length - 1, p.stepIndex + (id === 'step:next' ? 1 : -1)));
      p.checkMessage = '';
    } else if (id === 'step:check') void this.check();
    else if (id === 'help:fix') this.doFix();
    p.invalidate();
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (input.xr || e.target !== this.world.renderer.domElement) return;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    // the keypad sits in front of the panel: it gets the click first
    for (const [panel, act] of [[this.keypad, (id: string) => this.keypadPress(id)], [this.panel, (id: string) => this.press(id)]] as const) {
      if (!panel.mesh.visible) continue;
      const h = this.ray.intersectObject(panel.mesh, false)[0];
      const id = h?.uv ? panel.regionAtUv(h.uv) : null;
      panel.setHover(id);
      if (!down || !h) continue;
      e.stopImmediatePropagation();
      if (id) act(id);
      return;
    }
  }

  private place(): void {
    const eye = this.world.camera.getWorldPosition(this.v2);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.v);
    const toEye = this.tip.copy(eye).sub(at).setY(0).normalize();
    const xr = input.xr, narrow = (this.world.camera as PerspectiveCamera).aspect < 1.3;
    const m = this.panel.mesh;
    m.scale.setScalar(xr ? XR_TEXT_SCALE : 0.5);
    m.position.copy(at).addScaledVector(toEye, xr ? 0.12 : narrow ? 0.16 : 0.14);
    m.position.y += xr ? 0.16 : 0.07;
    m.lookAt(eye);
    const k = this.keypad.mesh;
    k.scale.setScalar(xr ? XR_TEXT_SCALE : 0.5);
    k.position.copy(m.position).addScaledVector(toEye, 0.04);
    k.position.y -= xr ? 0.06 : 0.02;
    k.lookAt(eye);
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    const now = performance.now();
    if (now - this.openedAt > IDLE_CLOSE_MS && !this.busy && !this.keypad.mesh.visible) return this.close();
    this.place();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const tip = h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null;
      if (this.keypad.mesh.visible) {
        const k = this.keypad.poke(tip, now);
        if (k) this.keypadPress(k);
      } else {
        const id = this.panel.poke(tip, now);
        if (id) this.press(id);
      }
    }
    this.panel.draw();
    this.keypad.draw();
  }
}
