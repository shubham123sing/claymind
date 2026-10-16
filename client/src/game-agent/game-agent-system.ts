/**
 * The game agent in the game (Play Kit -> Games -> "Make a game with AI"): game cards,
 * Surprise me, a typed name, "I don't know the rules", or the player's own rules (number
 * cards + typed words). The backend's answer (Kit Analyst, Researcher, Game Designer,
 * Referee) becomes a preview: Play, Show me how, Adjust (a rules card checked again by the
 * Referee here before playing) or Cancel.
 * Typing: prompt() in the browser, the pinch keypad in the headset (no voice input).
 * Offline: one plain line, and the built-in games keep working.
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import { templateById } from '../playkit/templates.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { room, type RoomMsg } from '../multiplayer/room-client.js';
import { validateSpec } from '../playkit/game-spec.js';
import { XR_TEXT_SCALE } from '../ui/canvas-panel.js';
import { applyNumbers, numbersOf, rulesInWords } from './adjust.js';
import { agentApi, OFFLINE, OfflineError, type GameAnswer } from './agent-client.js';
import { GameAgentPanel, RULE_LIMITS, type RuleNumbers, type View } from './game-agent-panel.js';
import { KeypadPanel } from '../ui/keypad.js';

const IDLE_CLOSE_MS = 90000;

export class GameAgentSystem extends createSystem({}) {
  private panel = new GameAgentPanel();
  private keypad = new KeypadPanel();
  private onTyped: ((text: string) => void) | null = null;
  private typedFallback = '';
  private history: View[] = [];
  private openedAt = 0;
  private busy = false;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private v = new Vector3();
  private v2 = new Vector3();
  private tip = new Vector3();

  init(): void {
    for (const [m, order] of [[this.panel.mesh, 24], [this.keypad.mesh, 26]] as const) {
      m.visible = false;
      m.renderOrder = order;
      (m.material as { depthTest: boolean }).depthTest = false;
      this.world.createTransformEntity(m);
    }
    this.cleanupFuncs.push(
      bus.on('gameagent:open', () => this.open()),
      // in a room anyone can make a game; the host decides what the room plays
      room.on('vote', (m) => this.suggested(m)),
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

  private go(view: View): void {
    if (this.panel.view !== view && this.panel.view !== 'thinking') this.history.push(this.panel.view);
    this.panel.view = view;
    this.panel.invalidate();
  }

  private back(): void {
    this.panel.view = this.history.pop() ?? 'games';
    this.panel.problems = [];
    this.panel.invalidate();
  }

  private open(): void {
    this.history = [];
    this.panel.view = 'games';
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    this.panel.online = null;
    this.panel.invalidate();
    void agentApi.online().then((ok) => {
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
      this.panel.view = this.history.pop() ?? 'games';
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

  // ---------- make a game ----------

  private async askGame(req: { name?: string; rules?: string; rulesUnknown?: boolean; surprise?: boolean }): Promise<void> {
    const status = req.rules ? 'Using your rules…' : req.rulesUnknown ? 'Looking up the rules…' : 'Choosing a game…';
    const answer = await this.run(status, () => agentApi.game(req, [...this.kit.kitItems()]));
    if (!answer) return;
    this.showPreview(answer);
  }

  private specOf(a: GameAnswer) {
    return a.spec ?? (a.templateId ? templateById(a.templateId) ?? null : null);
  }

  private showPreview(a: GameAnswer): void {
    const spec = this.specOf(a);
    if (!spec) return this.say("I couldn't make that game. The built-in games are in Play Kit -> Games.");
    if (room.connected && room.isHost) room.send('game', { data: { k: 'preview', name: a.preview.name } });
    this.panel.answer = a;
    this.panel.uses = this.kit.usesFor(spec);
    this.panel.view = 'preview';
    this.panel.invalidate();
  }

  private playGame(spec = this.panel.answer && this.specOf(this.panel.answer), demo = false): void {
    if (!spec) return;
    if (room.connected && !room.isHost && this.panel.answer) {
      room.send('vote', { data: { k: 'suggest', answer: { ...this.panel.answer, spec } } });
      return this.say('Sent to the host: in a room the host decides what everyone plays.');
    }
    const problems = demo ? this.kit.showMeHow(spec) : this.kit.playSpec(spec);
    if (problems.length) {
      this.panel.problems = problems;
      return this.say(`That game is not safe to play: ${problems[0]}`);
    }
    this.close();
  }

  /** Host: a player suggests a game (checked here like any game). */
  private suggested(m: RoomMsg): void {
    const d = m.data as { k?: string; answer?: GameAnswer } | undefined;
    if (!room.isHost || d?.k !== 'suggest' || !d.answer?.preview) return;
    const spec = this.specOf(d.answer);
    if (!spec || validateSpec(spec).length) return;
    const who = room.players.find((p) => p.id === m.from)?.name ?? 'A player';
    if (!this.panel.mesh.visible) this.open();
    this.showPreview({ ...d.answer, note: `${who} suggests this game` });
  }

  private step(k: keyof RuleNumbers, d: number): void {
    const [lo, hi, stepSize] = RULE_LIMITS[k];
    this.panel.numbers[k] = Math.max(lo, Math.min(hi, this.panel.numbers[k] + d * stepSize));
    this.panel.problems = [];
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
      if (p.showActivity) void agentApi.trace().then((t) => {
        p.activity = t.calls.map((c) => `${c.agent} · ${c.model} · ${c.ms} ms${c.cached ? ' · cached' : ''}${c.ok ? '' : ' · failed'}`);
        p.invalidate();
      }).catch(() => (p.activity = ['(offline)']));
    } else if (id === 'game:Surprise me') void this.askGame({ surprise: true });
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
    else if (id === 'preview:demo') this.playGame(undefined, true);
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
    }
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
