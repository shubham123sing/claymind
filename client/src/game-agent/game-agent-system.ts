/**
 * The game agent in the game (Play Kit -> Games -> "Make a game with AI"): game cards,
 * Surprise me, a typed name, "I don't know the rules", or the player's own rules (number
 * cards + typed words). The backend's answer (Kit Analyst, Researcher, Game Designer,
 * Referee) becomes a preview: Play, Show me how, Adjust (a rules card checked again by the
 * Referee here before playing) or Cancel.
 * Point + Say ("Show me with my hands"): point at pieces or hold them up and press what they
 * are, mark the goal or a path on the table, type the rest; the pointing words bind to what the
 * hands showed (binder.ts) and the player's pointing wins over any guess (intent.ts). With no
 * words to read it is all code, offline: the built-in game that fits, set up the way shown.
 * Typing: prompt() in the browser, the pinch keypad in the headset (no voice input).
 * Offline: one plain line, and the built-in games keep working.
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import { TEMPLATES, templateById } from '../playkit/templates.js';
import { dryRunInWorker } from '../sim/sim-client.js';
import type { DryRun } from '../sim/dry-run.js';
import type { GameSpec, RoleSpec } from '../playkit/game-spec.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { room, type RoomMsg } from '../multiplayer/room-client.js';
import { validateSpec } from '../playkit/game-spec.js';
import { XR_TEXT_SCALE } from '../ui/canvas-panel.js';
import { applyNumbers, numbersOf, rulesInWords } from './adjust.js';
import { agentApi, OFFLINE, OfflineError, type GameAnswer } from './agent-client.js';
import { GameAgentPanel, RULE_LIMITS, type RuleNumbers, type View } from './game-agent-panel.js';
import { KeypadPanel } from '../ui/keypad.js';
import { ObjectSystem } from '../objects/object-system.js';
import { bind, bindOrdered, type Word } from './binder.js';
import { addRole, applyIntent, chooseGame, ROLE_WORDS, rolesFromNames, rolesFromWords, tagged, type Intent, type RoleWord } from './intent.js';
import { PointSaySystem } from './point-say.js';

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
  /** Point + Say: what has been shown and said so far */
  private intent: Intent = { roles: [], zones: [], paths: [], text: '' };
  private pending: RoleWord | null = null;
  /** pieces given a role with a chip or the confirm card: typed words do not change them */
  private chipped = new Set<string>();
  /** the roles the player chose for the game being previewed (game role -> kit item) */
  private chosen: Record<string, string> = {};

  init(): void {
    for (const [m, order] of [[this.panel.mesh, 24], [this.keypad.mesh, 26]] as const) {
      m.visible = false;
      m.renderOrder = order;
      (m.material as { depthTest: boolean }).depthTest = false;
      this.world.createTransformEntity(m);
    }
    // a hosted backend may be asleep (free tier): one quiet check now wakes it while the player builds
    void agentApi.online();
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

  private get ps() {
    return this.world.getSystem(PointSaySystem)!;
  }

  // ---------- views ----------

  private go(view: View): void {
    if (this.panel.view !== view && this.panel.view !== 'thinking') this.history.push(this.panel.view);
    this.panel.view = view;
    this.panel.invalidate();
  }

  private back(): void {
    if (this.panel.view === 'describe') this.endDescribe();
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
    this.endDescribe();
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

  private async askGame(req: { name?: string; rules?: string; rulesUnknown?: boolean; surprise?: boolean }, shown?: Intent, local?: GameAnswer): Promise<void> {
    const status = req.rules ? 'Using your rules…' : req.rulesUnknown ? 'Looking up the rules…' : 'Choosing a game…';
    const kitOf = shown ? await this.kitOfShown(shown) : null;
    const withShown = (a: GameAnswer): GameAnswer => (shown && kitOf ? this.withIntent(a, shown, kitOf) : a);
    this.chosen = {};
    let answer: GameAnswer | null = local ?? (await this.run(status, () => agentApi.game(req, [...this.kit.kitItems()])));
    if (!answer) return;
    answer = withShown(answer);
    // the Referee's dry run: a designed game (not a tested built-in one) is played in the real physics first
    // in order: the player's toys that failed become built-in pieces; the agent fixes its game once; the closest built-in game
    const dropped = new Set<string>();
    let fixTried = false;
    for (let round = 0; round < 3; round++) {
      const spec: GameSpec | null = answer.spec;
      if (!spec) break;
      const check: DryRun | null = await this.run('Testing it in the physics…', (): Promise<DryRun> => dryRunInWorker(this.kit.dryRunScene(spec, this.chosen), spec));
      if (!check) return;
      answer.physics = { ok: check.ok, problems: check.problems };
      if (check.ok) break;
      const mine: RoleSpec[] = spec.roles.filter((r) => this.chosen[r.id]);
      if (mine.length) {
        // the player's toys first: the ones the test names (else all) become built-in pieces, the rest stays as shown
        const named: RoleSpec[] = mine.filter((r) => check.problems.some((p) => p.includes(r.label)));
        const notes: string[] = (named.length ? named : mine).map((r) => {
          const note = `Your ${this.kit.kitName(this.chosen[r.id])} did not work as ${r.label.toLowerCase()} in the physics test: built-in ones instead`;
          dropped.add(this.chosen[r.id]);
          delete this.chosen[r.id];
          return note;
        });
        answer = { ...answer, cannot: [...notes, ...answer.cannot] };
        continue;
      }
      if (!local && !fixTried) {
        fixTried = true;
        const problems: string[] = check.problems;
        const fixed: GameAnswer | null = await this.run('Fixing what the test found…', (): Promise<GameAnswer> => agentApi.game({ ...req, checkProblems: problems }, [...this.kit.kitItems()]));
        if (!fixed) return;
        answer = withShown(fixed);
        for (const [role, kitId] of Object.entries(this.chosen)) if (dropped.has(kitId)) delete this.chosen[role];
      } else {
        answer = this.safeInstead(answer, check.problems);
        this.chosen = {};
        break;
      }
    }
    this.showPreview(answer);
  }

  // ---------- Point + Say ----------

  private startDescribe(): void {
    this.intent = { roles: [], zones: [], paths: [], text: '' };
    this.chipped.clear();
    this.ps.clearMarks();
    this.ps.begin();
    this.ps.marking = null;
    Object.assign(this.panel, { hint: '', hintOk: true, marking: null });
    this.understand();
    this.go('describe');
  }

  private endDescribe(): void {
    if (!this.ps.active) return;
    this.ps.end();
    this.panel.marking = null;
  }

  private hint(text: string, ok = true): void {
    this.panel.hint = text;
    this.panel.hintOk = ok;
  }

  /** The "understood so far" list, from the intent and the marks on the table. */
  private understand(): void {
    const i = this.intent, lines: string[] = [];
    for (const r of i.roles) lines.push(`The ${r.role}${r.items.length > 1 ? 's' : ''}: ${r.items.map((k) => this.kit.itemName(k)).join(', ')}`);
    const zones = this.ps.marks.filter((m) => m.kind === 'zone').length, paths = this.ps.marks.filter((m) => m.kind === 'path').length;
    if (zones) lines.push(`${zones} zone${zones > 1 ? 's' : ''} on the table${i.goal ? ' (one is the goal)' : ''}`);
    if (paths) lines.push(`${paths} path${paths > 1 ? 's' : ''} on the table`);
    if (i.text) lines.push(`You said: "${i.text}"`);
    this.panel.understood = lines;
    this.panel.canMake = lines.length > 0;
  }

  /** A chip ("This is the ball", "Here is the goal"): its words at this moment, bound to what the hands showed. */
  private chip(role: RoleWord | 'here'): void {
    const now = performance.now(), ps = this.ps;
    const text = role === 'here' ? 'here is the goal' : `this is the ${role}`;
    const words: Word[] = text.split(' ').map((w, k) => ({ text: w, t: now + k * 120 }));
    const r = bind(words, ps.attention, ps.now());
    if (r.ambiguous.length) {
      // one short question, the first candidate glowing
      this.pending = role === 'here' ? 'goal' : role;
      const options = r.ambiguous[0].options;
      const first = options[0], id = first.slice(first.indexOf(':') + 1);
      this.world.getSystem(ObjectSystem)?.highlight(first.startsWith('toy:') ? { toyId: id } : { creationId: id });
      this.panel.question = `Which one is the ${this.pending}?`;
      this.panel.options = options.map((o) => [o, this.kit.itemName(o)]);
      return this.go('confirm');
    }
    const got = rolesFromWords(words, r);
    // "Here is the goal" a little after the loop was drawn (the hand had to reach the panel): the latest zone
    const lastZone = [...ps.marks].reverse().find((m) => m.kind === 'zone');
    if (role === 'here' && !got.goal && !got.roles.length && lastZone) got.goal = lastZone.id;
    if (got.goal) {
      this.intent.goal = got.goal;
      this.hint('Got it: that zone is the goal');
    } else if (got.roles.length) {
      for (const a of got.roles) {
        addRole(this.intent.roles, a.role, a.items);
        a.items.forEach((k) => this.chipped.add(k));
      }
      this.hint(`Got it: ${got.roles[0].items.map((k) => this.kit.itemName(k)).join(', ')} = the ${got.roles[0].role}`);
    } else if (role === 'here') this.hint('Mark a zone first: press Mark a zone, then pinch and draw a loop on the table', false);
    else this.hint('Point at it or hold it up first, then press within 2 seconds', false);
    this.understand();
  }

  private picked(item: string): void {
    if (item && this.pending) {
      addRole(this.intent.roles, this.pending, [item]);
      this.chipped.add(item);
    }
    this.hint(item ? `Got it: ${this.kit.itemName(item)} = the ${this.pending}` : 'Point at it again, a little longer', !!item);
    this.pending = null;
    this.understand();
    this.panel.view = this.history.pop() ?? 'describe';
  }

  /** Typed words: pointing words bind to what was shown, in order; role words are read too. */
  private typed(text: string): void {
    const words: Word[] = text.split(/\s+/).filter(Boolean).map((w, k) => ({ text: w, t: k }));
    // the piece in a hand while typing ("hold it in one hand, type with the other"): "this" means it
    const held = this.ps.now().held;
    const bound = bindOrdered(words, this.ps.attention, (k) => this.kit.itemName(k), held.length === 1 ? held[0] : null);
    const got = rolesFromWords(words, bound);
    // pieces named in the words ("the Red ball is the ball"), unless the hands already said what they are
    const pointed = new Set(got.roles.flatMap((r) => r.items));
    for (const a of rolesFromNames(text, this.kit.tableItems())) got.roles.push({ role: a.role, items: a.items.filter((k) => !pointed.has(k)) });
    // what the hands and chips said wins: typed words only give roles to pieces without one ("knock them down")
    for (const a of got.roles) {
      const free = a.items.filter((k) => !this.chipped.has(k));
      if (free.length) addRole(this.intent.roles, a.role, free);
    }
    if (got.goal) this.intent.goal = got.goal;
    this.intent.text = text;
    this.hint(got.roles.length || got.goal ? 'Got it' : 'Noted');
    this.understand();
    // items pointed at but not named ("flick this so it knocks those off"): the Intent Resolver reads the words, when it is there
    if (got.unnamed.length && this.panel.online) void this.resolve(words, bound.bindings);
  }

  private async resolve(words: Word[], bindings: Parameters<typeof tagged>[1]): Promise<void> {
    const t = tagged(words, bindings, (k) => this.kit.itemName(k));
    const marks = this.ps.marks;
    this.hint('Reading your words…');
    this.panel.invalidate();
    try {
      const r = await agentApi.intent({ text: t.text.slice(0, 300), items: t.items, zones: marks.filter((m) => m.kind === 'zone').length, paths: marks.filter((m) => m.kind === 'path').length });
      // only items with no role yet: a chip or a role word the player gave wins
      const named = new Set(this.intent.roles.flatMap((x) => x.items));
      for (const x of r.roles) if (t.refs[x.ref] && !named.has(t.refs[x.ref]) && (ROLE_WORDS as readonly string[]).includes(x.role)) addRole(this.intent.roles, x.role as RoleWord, [t.refs[x.ref]]);
      if (r.game) this.intent.game = r.game;
      if (r.goalIsMarkedZone && !this.intent.goal) this.intent.goal = marks.find((m) => m.kind === 'zone')?.id;
      this.hint(r.unsure.length ? `Not sure about ${r.unsure.map((u) => t.items[u]).join(', ')}: press a chip for it` : 'Got it', !r.unsure.length);
    } catch {
      this.hint('Could not read the words now: press a chip for each piece', false);
    }
    this.understand();
    this.panel.invalidate();
  }

  private async make(): Promise<void> {
    const marks = this.ps.marks;
    const shown: Intent = { ...this.intent, roles: this.intent.roles.map((r) => ({ ...r, items: [...r.items] })), zones: marks.filter((m) => m.kind === 'zone'), paths: marks.filter((m) => m.kind === 'path') };
    this.endDescribe();
    const pick = chooseGame(shown, TEMPLATES, (k) => this.kit.itemName(k));
    // with words, the agent reads them (when it is there), told the game the code chose from the chips
    // and words (a free model alone made "knock them down" + a target chip a Target throw); otherwise
    // all code: instant and offline
    if (shown.text && this.panel.online) return this.askGame({ name: (shown.game ?? pick?.spec.name ?? shown.text).slice(0, 60), rules: this.shownInWords(shown) }, shown);
    if (!pick) {
      this.ps.begin();
      return this.hint('Show me at least one piece and what it is, or type the name of the game', false);
    }
    const local: GameAnswer = {
      path: 'template', note: 'A built-in game, set up the way you showed', templateId: pick.spec.id, spec: pick.spec,
      preview: { name: pick.spec.name, howToPlay: pick.spec.howToPlay.slice(0, 4), missing: [] }, cannot: [], adjustments: [], sources: [], guessed: false,
    };
    return this.askGame({}, shown, local);
  }

  /** What was shown, in words for the game agent; the roles and marks are applied here anyway. */
  private shownInWords(i: Intent): string {
    const parts = i.roles.map((r) => `the ${r.role}${r.items.length > 1 ? 's are' : ' is'} ${r.items.map((k) => this.kit.itemName(k)).join(', ')}`);
    if (i.zones.length) parts.push(`${i.zones.length} zone(s) marked on the table${i.goal ? ', one is the goal' : ''}`);
    if (i.paths.length) parts.push(`${i.paths.length} path(s) drawn on the table`);
    return `${i.text}. Shown with the hands: ${parts.join('; ') || 'nothing'}.`.slice(0, 600);
  }

  /** Every item shown -> its kit item (creations are added to the Play Kit). */
  private async kitOfShown(i: Intent): Promise<Map<string, string | null>> {
    const items = [...new Set(i.roles.flatMap((r) => r.items))];
    return new Map(await Promise.all(items.map(async (k) => [k, await this.kit.kitIdOfItem(k)] as const)));
  }

  /** The player's pointing wins: their toys in their roles, their marks as zones and paths. */
  private withIntent(a: GameAnswer, shown: Intent, kitOf: Map<string, string | null>): GameAnswer {
    const base = this.specOf(a);
    if (!base) return a;
    const r = applyIntent(base, shown, (k) => kitOf.get(k) ?? null);
    if (r.problems.length) return { ...a, cannot: [...a.cannot, `Your set-up: ${r.problems[0]}`] };
    this.chosen = r.roleMap;
    return { ...a, spec: r.spec, cannot: [...r.notes, ...a.cannot], preview: { ...a.preview, howToPlay: r.spec.howToPlay.slice(0, 4) } };
  }

  /** The physics test failed twice: the closest built-in game, which is known to work. */
  private safeInstead(a: GameAnswer, problems: string[]): GameAnswer {
    const id = a.spec?.id ?? '';
    const t = TEMPLATES.find((x) => id.startsWith(x.id)) ?? TEMPLATES.find((x) => x.roles.some((r) => a.spec?.roles.some((q) => q.fallback === r.fallback))) ?? TEMPLATES[0];
    return {
      ...a, path: 'fallback', templateId: t.id, spec: null, note: `The physics test found: ${problems[0]}. Here is ${t.name} instead`,
      preview: { name: t.name, howToPlay: t.howToPlay.slice(0, 4), missing: a.preview.missing }, physics: { ok: true, problems: [] },
    };
  }

  private specOf(a: GameAnswer) {
    return a.spec ?? (a.templateId ? templateById(a.templateId) ?? null : null);
  }

  private showPreview(a: GameAnswer): void {
    const spec = this.specOf(a);
    if (!spec) return this.say("I couldn't make that game. The built-in games are in Play Kit -> Games.");
    if (room.connected && room.isHost) room.send('game', { data: { k: 'preview', name: a.preview.name } });
    this.panel.answer = a;
    this.panel.uses = this.kit.usesFor(spec, this.chosen);
    this.panel.view = 'preview';
    this.panel.invalidate();
  }

  private playGame(spec = this.panel.answer && this.specOf(this.panel.answer), demo = false): void {
    if (!spec) return;
    if (room.connected && !room.isHost && this.panel.answer) {
      room.send('vote', { data: { k: 'suggest', answer: { ...this.panel.answer, spec } } });
      return this.say('Sent to the host: in a room the host decides what everyone plays.');
    }
    const problems = demo ? this.kit.showMeHow(spec, this.chosen) : this.kit.playSpec(spec, this.chosen);
    if (problems.length) {
      this.panel.problems = problems;
      return this.say(`That game is not safe to play: ${problems[0]}`);
    }
    this.ps.clearMarks();
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
    else if (id === 'game:describe') this.startDescribe();
    else if (id.startsWith('chip:')) this.chip(id.slice(5) as RoleWord | 'here');
    else if (id.startsWith('mark:')) {
      const kind = id.slice(5) as 'zone' | 'path';
      this.ps.marking = p.marking = p.marking === kind ? null : kind;
      this.hint(p.marking ? `Pinch on the table and draw ${kind === 'zone' ? 'a loop around the area' : 'the way'}, then let go` : 'Done');
    } else if (id === 'describe:type') this.type('Say it in words (this, these, here…)', (t) => this.typed(t));
    else if (id === 'describe:clear') this.startDescribe();
    else if (id === 'describe:make') void this.make();
    else if (id.startsWith('pick:')) this.picked(id.slice(5));
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
