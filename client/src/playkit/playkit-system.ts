/**
 * Play Kit (Update 2, Step 1): the player's own toy box, Sets and the built-in
 * games, all offline.
 * - Kit: add the current creation, place toys on the table, rename, change role,
 *   duplicate, remove (Undo); download / import the kit.
 * - Sets: save what is on the table (poses relative to the table, pinned, the
 *   game), open, rename, delete (Undo).
 * - Games: pick a template, check which toy plays each role, Play.
 * - Edit / Play: Edit pins every piece where it is put; Play lets physics run
 *   (boards, ramps and cups stay fixed); Pause freezes the physics; Reset puts
 *   the Set back exactly as it started; End clears the table and the clay returns.
 * The play area sits where the clay is, facing the player (the clay is hidden
 * meanwhile). The rule engine sees pieces in that frame.
 */
import {
  BufferGeometry, createSystem, DoubleSide, EdgesGeometry, Entity, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PhysicsSystem, PlaneGeometry, Quaternion, Raycaster, RingGeometry, Vector2, Vector3,
} from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { downloadFile } from '../export/project-file.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { copySaved, fromSurfaceFrame, toSurfaceFrame, type SavedPart } from '../storage/library.js';
import { XR_TEXT_SCALE } from '../ui/canvas-panel.js';
import { offerUndo } from '../ui/undo-toast.js';
import { bottomOf, fallbackParts } from './fallback-shapes.js';
import { ROLE_TAGS, validateSpec, type FallbackShape, type GameSpec, type RoleSpec } from './game-spec.js';
import {
  deleteKitItem, deleteSet, fitScore, kitToJson, loadKit, loadSets, makeKitItem, saveKitItem, saveSet, suggestRoleMap,
  KIT_SCHEMA, type KitItem, type PlaySet, type SetPiece,
} from './kit-store.js';
import { GameHud, PlayKitPanel } from './playkit-panels.js';
import { RuleEngine, type Observation } from './rule-engine.js';
import { TEMPLATES, templateById } from './templates.js';

interface Piece {
  toyId: string;
  kitId: string | null;
  builtin?: { shape: FallbackShape; material: string };
  /** `role:index` in a game. */
  key?: string;
  role?: string;
  /** Fixed while playing (board, ramp, cups, or pinned in a saved Set). */
  fixed: boolean;
  start: { p: number[]; q: number[] };
  /** What it is made of (to bring it back if it broke or went missing). */
  parts: SavedPart[];
}

const CONFIRM_MS = 3000;
const IDLE_CLOSE_MS = 45000;
const MESSAGE_MS = 3000;
/** Play-area centre: this far in from the table's near edge (m). */
const PLAY_DEPTH = 0.24;

export class PlayKitSystem extends createSystem({}) {
  private panel = new PlayKitPanel();
  private hud = new GameHud();
  private kit: KitItem[] = [];
  private sets: PlaySet[] = [];
  private mode: 'off' | 'edit' | 'play' = 'off';
  private pieces: Piece[] = [];
  private spec: GameSpec | null = null;
  private roleMap: Record<string, string | null> = {};
  private engine: RuleEngine | null = null;
  private setName = '';
  private paused = false;
  private origin = new Vector3();
  private yaw = 0;
  private contacts: [string, string][] = [];
  private shots: string[] = [];
  private seq = 0;
  private openedAt = 0;
  private armedAt = -Infinity;
  private messageAt = 0;
  private v = new Vector3();
  private v2 = new Vector3();
  private q = new Quaternion();
  private st = { p: new Vector3(), q: new Quaternion() };
  private tip = new Vector3();
  private ray = new Raycaster();
  private ndc = new Vector2();

  init(): void {
    this.panel.games = TEMPLATES;
    for (const [m, order] of [[this.panel.mesh, 23], [this.hud.mesh, 21]] as const) {
      m.visible = false;
      m.renderOrder = order;
      (m.material as { depthTest: boolean }).depthTest = false;
      this.world.createTransformEntity(m);
    }
    this.cleanupFuncs.push(
      bus.on('playkit:toggle', () => (this.panel.mesh.visible ? this.closePanel() : this.openPanel())),
      bus.on('playkit:add', () => void this.addCurrent()),
      bus.on('toy:shot', (e) => this.shots.push(e.toyId)),
      bus.on('toy:contact', (e) => this.contacts.push([e.a, e.b])),
      bus.on('toy:released', (e) => {
        // Edit: a piece stays where it is put
        if (this.mode === 'edit' && this.pieces.some((p) => p.toyId === e.toyId)) this.objects.setToyPinned(e.toyId, true);
      }),
    );
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
    void Promise.all([loadKit(), loadSets()]).then(([kit, sets]) => {
      this.kit = kit;
      this.sets = sets;
      this.refreshPanel();
    });
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private get sculpt() {
    return this.world.getSystem(SculptSystem)!;
  }

  private toast(text: string, color?: string): void {
    bus.emit('ui:toast', { text, color });
  }

  private ask(title: string, fallback: string): string | null {
    if (input.xr || typeof prompt !== 'function') return fallback; // no keyboard in the headset: the default name
    const v = prompt(title, fallback);
    return v === null ? null : v.trim().slice(0, 40) || fallback;
  }

  private refreshPanel(): void {
    const p = this.panel;
    p.kit = this.kit;
    p.sets = this.sets;
    p.canSaveSet = this.pieces.length > 0;
    if (p.selectedKit && !this.kit.some((k) => k.id === p.selectedKit)) p.selectedKit = null;
    if (p.selectedSet && !this.sets.some((s) => s.id === p.selectedSet)) p.selectedSet = null;
    p.invalidate();
  }

  // ---------- play-area frame (metres; +z toward the player) ----------

  /**
   * The play area: on the table in front of the player, its centre PLAY_DEPTH in
   * from the near edge (or the table's middle when it is shallower), so every
   * layout (within ±22 cm) stays on the table.
   */
  private computeFrame(): void {
    const eye = this.world.camera.getWorldPosition(this.v2);
    nearestSurfacePoint(eye.x, eye.z, PLAY_DEPTH, this.xz);
    this.origin.set(this.xz[0], surface.topY, this.xz[1]);
    this.yaw = Math.atan2(eye.x - this.xz[0], eye.z - this.xz[1]);
  }
  private xz = [0, 0];

  private toWorld(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.origin.x + x * c + z * s, this.origin.y + y, this.origin.z - x * s + z * c);
  }

  private toLocal(w: Vector3): [number, number, number] {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = w.x - this.origin.x, dz = w.z - this.origin.z;
    return [dx * c - dz * s, w.y - this.origin.y, dx * s + dz * c];
  }

  private yawQ(extra = 0): number[] {
    return this.q.setFromAxisAngle(this.v.set(0, 1, 0), this.yaw + extra).toArray();
  }

  // ---------- pieces ----------

  private partsOf(p: { kitId: string | null; builtin?: { shape: FallbackShape; material: string } }, color: string | null = null): SavedPart[] | null {
    if (p.kitId) return this.kit.find((k) => k.id === p.kitId)?.data.parts ?? null;
    return p.builtin ? fallbackParts(p.builtin.shape, p.builtin.material, color) : null;
  }

  /** Put a piece on the table at a play-area spot (bottom centre). */
  private spawnLocal(parts: SavedPart[], at: [number, number, number], rotY: number, pinned: boolean, meta: Omit<Piece, 'toyId' | 'start' | 'parts'>): Piece | null {
    const lift = at[1] - bottomOf(parts) + 0.001;
    const p = this.toWorld(at[0], lift, at[2]).toArray(), q = this.yawQ(rotY);
    return this.spawnWorld(parts, p, q, pinned, meta);
  }

  private spawnWorld(parts: SavedPart[], p: number[], q: number[], pinned: boolean, meta: Omit<Piece, 'toyId' | 'start' | 'parts'>): Piece | null {
    const toyId = `toy_${++this.seq}`;
    if (!this.objects.spawnToy(toyId, parts, p, q, pinned)) {
      this.toast('The table is full (40 pieces)');
      return null;
    }
    const piece: Piece = { ...meta, toyId, start: { p, q }, parts };
    this.pieces.push(piece);
    return piece;
  }

  private clearTable(): void {
    for (const p of this.pieces) this.objects.removeToy(p.toyId);
    this.pieces = [];
    this.clearZones();
  }

  // ---------- zone markers: where the scoring areas are ----------

  private zoneMarks: { entity: Entity; geo: BufferGeometry; mat: MeshBasicMaterial | LineBasicMaterial }[] = [];

  private showZones(spec: GameSpec): void {
    this.clearZones();
    // fixed pieces (board, cups) under a zone lift its marker onto them
    const fixed = this.pieces.filter((p) => p.fixed).map((p) => {
      const s = this.objects.toyState(p.toyId, this.st);
      return s ? { at: this.toLocal(this.st.p), top: s.top - this.origin.y, r: Math.max(s.halfH, 0.04) } : null;
    }).filter((f) => f !== null);
    for (const z of spec.zones) {
      let y = Math.max(0, z.center[1] - z.size[1] / 2);
      for (const f of fixed) {
        const inside = Math.hypot(f.at[0] - z.center[0], f.at[2] - z.center[2]) < Math.max(f.r, 0.2);
        if (inside && f.top < z.center[1] + z.size[1] / 2 + 0.01) y = Math.max(y, f.top);
      }
      y += 0.002;
      let obj: Mesh | LineSegments, geo: BufferGeometry, mat: MeshBasicMaterial | LineBasicMaterial;
      if (z.shape === 'cylinder') {
        geo = new RingGeometry(z.size[0] * 0.8, z.size[0], 32);
        mat = new MeshBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.75, side: DoubleSide, depthWrite: false });
        obj = new Mesh(geo, mat);
      } else {
        const plane = new PlaneGeometry(z.size[0], z.size[2]);
        geo = new EdgesGeometry(plane);
        plane.dispose();
        mat = new LineBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.9 });
        obj = new LineSegments(geo, mat);
      }
      obj.rotation.set(-Math.PI / 2, this.yaw, 0, 'YXZ'); // flat on the table, turned with the play area
      obj.renderOrder = 5;
      this.toWorld(z.center[0], y, z.center[2], obj.position);
      this.zoneMarks.push({ entity: this.world.createTransformEntity(obj), geo, mat });
    }
  }

  private clearZones(): void {
    for (const m of this.zoneMarks) {
      m.entity.dispose({ disposeResources: false });
      m.geo.dispose();
      m.mat.dispose();
    }
    this.zoneMarks = [];
  }

  private enterTable(): void {
    if (this.mode === 'off') {
      this.computeFrame();
      this.sculpt.setSuspended(true);
    }
  }

  // ---------- modes ----------

  /** Edit: everything pinned where it is, free to move by hand. Play: physics runs, fixed pieces locked. */
  private applyMode(): void {
    for (const p of this.pieces) {
      const pinned = this.mode === 'edit' || p.fixed;
      this.objects.setToyPinned(p.toyId, pinned);
      this.objects.setToyLocked(p.toyId, this.mode === 'play' && p.fixed);
    }
    this.syncHud();
  }

  private setMode(mode: 'edit' | 'play'): void {
    if (this.paused) this.setPaused(false);
    this.mode = mode;
    if (mode === 'play' && this.spec && !this.engine) this.engine = new RuleEngine(this.spec);
    this.applyMode();
  }

  private setPaused(on: boolean): void {
    const physics = this.world.getSystem(PhysicsSystem);
    this.paused = on;
    if (on) physics?.stop();
    else physics?.play();
    this.syncHud();
  }

  reset(): void {
    if (this.paused) this.setPaused(false);
    for (const p of this.pieces) {
      const pinned = this.mode === 'edit' || p.fixed;
      if (this.objects.toyState(p.toyId, this.st)) this.objects.placeToy(p.toyId, p.start.p, p.start.q, pinned);
      else this.objects.spawnToy(p.toyId, p.parts, p.start.p, p.start.q, pinned); // it broke or went missing: a new one
    }
    for (const p of this.pieces) this.objects.setToyLocked(p.toyId, this.mode === 'play' && p.fixed);
    this.engine?.reset();
    this.hud.message = '';
    this.hud.over = false;
    this.hud.showRules = !!this.spec;
    this.contacts.length = 0;
    this.shots.length = 0;
    uiSounds.tick(2);
    this.syncHud();
  }

  end(): void {
    if (this.paused) this.setPaused(false);
    this.clearTable();
    this.mode = 'off';
    this.spec = null;
    this.engine = null;
    this.hud.mesh.visible = false;
    this.sculpt.setSuspended(false);
    this.refreshPanel();
  }

  // ---------- games ----------

  private colorFor(role: RoleSpec, i: number): string | null {
    if (role.fallback === 'coin') return i % 2 ? '#2d2d2d' : '#f4f1ec';
    if (role.fallback === 'disc') return '#e2733b';
    if (role.fallback === 'ball' || role.fallback === 'marble') return ['#e2733b', '#5aa9e6', '#5fbf72', '#f0b429', '#b48cf2'][i % 5];
    return null;
  }

  /** The toy box (read-only for other systems, e.g. the AI helper's kit summary). */
  kitItems(): readonly KitItem[] {
    return this.kit;
  }

  get playMode(): 'off' | 'edit' | 'play' {
    return this.mode;
  }

  get gameName(): string | null {
    return this.spec?.name ?? null;
  }

  /** Play a game from outside (the AI helper): checked first, the player's toys fill the roles they fit. */
  playSpec(spec: GameSpec): string[] {
    const problems = validateSpec(spec);
    if (problems.length) return problems;
    this.startGame(spec, suggestRoleMap(spec, this.kit));
    return [];
  }

  /** Which toy plays each role of a game (names), for a preview. */
  usesFor(spec: GameSpec): string[] {
    const map = suggestRoleMap(spec, this.kit);
    return spec.roles.map((r) => {
      const k = map[r.id] ? this.kit.find((x) => x.id === map[r.id]) : null;
      return `${r.label}: ${k ? `your ${k.name}` : `built-in ${r.fallback}`}`;
    });
  }

  private startGame(spec: GameSpec, roleMap: Record<string, string | null>): void {
    if (this.mode !== 'off') this.end();
    this.enterTable();
    this.spec = spec;
    this.roleMap = { ...roleMap };
    this.setName = spec.name;
    const count = new Map<string, number>();
    for (const place of spec.layout) {
      const role = spec.roles.find((r) => r.id === place.role)!;
      const i = count.get(role.id) ?? 0;
      count.set(role.id, i + 1);
      const kitId = roleMap[role.id] ?? null;
      const builtin = kitId ? undefined : { shape: role.fallback, material: role.material };
      const parts = this.partsOf({ kitId, builtin }, this.colorFor(role, i));
      if (!parts) continue;
      this.spawnLocal(parts, place.at, place.rotY ?? 0, !!role.pinned, { kitId, builtin, key: `${role.id}:${i}`, role: role.id, fixed: !!role.pinned });
    }
    this.engine = new RuleEngine(spec);
    this.showZones(spec);
    this.mode = 'play';
    this.hud.rules = spec.howToPlay;
    this.hud.showRules = true;
    this.hud.message = '';
    this.hud.over = false;
    this.applyMode();
    this.closePanel();
    this.hud.mesh.visible = true;
    uiSounds.chime();
  }

  private tickGame(dt: number): void {
    const e = this.engine;
    if (!e || this.mode !== 'play' || this.paused || e.state.over) return;
    const byToy = new Map(this.pieces.filter((p) => p.key).map((p) => [p.toyId, p]));
    const obs: Observation = { pieces: [], contacts: [], shots: [] };
    for (const p of byToy.values()) {
      const s = this.objects.toyState(p.toyId, this.st);
      if (!s) continue;
      obs.pieces.push({ key: p.key!, role: p.role!, p: this.toLocal(this.st.p), top: s.top - this.origin.y, speed: s.speed, held: s.held });
    }
    for (const [a, b] of this.contacts) {
      const pa = byToy.get(a), pb = byToy.get(b);
      if (pa && pb) obs.contacts.push([pa.key!, pb.key!]);
    }
    for (const t of this.shots) {
      const p = byToy.get(t);
      if (p) obs.shots.push(p.key!);
    }
    this.contacts.length = 0;
    this.shots.length = 0;
    if (obs.shots.length) this.hud.showRules = false;
    for (const c of e.tick(dt, obs)) {
      if (c.type === 'message') {
        this.hud.message = c.text;
        this.messageAt = performance.now();
        this.toast(c.text);
        continue;
      }
      const piece = this.pieces.find((p) => p.key === c.key);
      if (!piece) continue;
      const role = this.spec!.roles.find((r) => r.id === piece.role);
      if (c.type === 'respawn' && role?.respawnAt) {
        const i = Number(piece.key!.split(':')[1]) || 0, r = role.respawnAt;
        const w = this.toWorld(r[0] + (i % 3) * 0.035, r[1] + 0.02, r[2] + Math.floor(i / 3) * 0.035);
        this.objects.placeToy(piece.toyId, w.toArray(), piece.start.q, false);
      } else this.objects.placeToy(piece.toyId, piece.start.p, piece.start.q, false);
    }
    if (e.state.over && !this.hud.over) {
      this.hud.over = true;
      this.hud.message = e.state.message;
      uiSounds.chime();
    }
    this.syncHud();
  }

  private syncHud(): void {
    const h = this.hud;
    h.title = this.setName || 'Play Kit';
    h.mode = this.mode === 'play' ? 'play' : 'edit';
    h.paused = this.paused;
    h.hasGame = !!this.spec;
    const lines = this.engine ? this.engine.scoreboard() : this.spec ? [] : [`${this.pieces.length} piece(s) on the table`];
    if (!this.spec) lines.push(this.mode === 'edit' ? 'Move pieces by hand; Play lets physics run.' : 'Throw, flick, push, stack: Reset puts it back.');
    if (lines.join() !== h.lines.join()) h.lines = lines;
    h.invalidate();
  }

  // ---------- kit ----------

  private currentCreationId(): string | null {
    const t = this.objects.focusTarget();
    if (t) return t.creationId;
    const ids = this.objects.liveCreationIds().filter((x) => !x.includes('#exp'));
    return ids[ids.length - 1] ?? null;
  }

  async addCurrent(): Promise<void> {
    const id = this.currentCreationId();
    const s = id ? this.objects.serialize(id) : null;
    if (!s) {
      this.toast(id ? 'One moment, the material is still settling' : 'Bring something to life first, then Add to Play Kit');
      return;
    }
    const name = this.ask('Name for the Play Kit', s.creation.name && s.creation.name !== 'Creation' ? s.creation.name : `Toy ${this.kit.length + 1}`);
    if (name === null) return;
    const item = makeKitItem(s, name);
    await saveKitItem(item);
    this.kit.push(item);
    this.panel.selectedKit = item.id;
    this.refreshPanel();
    uiSounds.tick();
    offerUndo(`Added "${name}" to the Play Kit (${item.role})`, () => void this.removeKit(item.id), input.xr);
  }

  private async removeKit(id: string): Promise<void> {
    await deleteKitItem(id);
    this.kit = this.kit.filter((k) => k.id !== id);
    this.refreshPanel();
  }

  private placeKit(item: KitItem): void {
    if (this.mode === 'off') {
      this.enterTable();
      this.mode = 'edit';
      this.spec = null;
      this.engine = null;
      this.setName = '';
      this.hud.mesh.visible = true;
    }
    // next free spot along a row in front of the play area
    const n = this.pieces.length, x = ((n % 7) - 3) * 0.07, z = 0.02 - Math.floor(n / 7) * 0.08;
    this.spawnLocal(item.data.parts, [x, 0, z], 0, this.mode === 'edit', { kitId: item.id, fixed: false });
    this.refreshPanel();
    this.syncHud();
    uiSounds.tick();
  }

  importKit(items: KitItem[], sets: PlaySet[]): void {
    const idMap = new Map<string, string>();
    for (const k of items) {
      const id = `kit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      idMap.set(k.id, id);
      const item: KitItem = { ...k, id, data: copySaved(k.data, id, k.name), addedAt: Date.now() };
      void saveKitItem(item);
      this.kit.push(item);
    }
    for (const s of sets) {
      const set: PlaySet = {
        ...s, id: `set_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: Date.now(),
        pieces: s.pieces.map((p) => ({ ...p, kitId: p.kitId ? idMap.get(p.kitId) ?? null : null })),
        game: s.game ? { ...s.game, roleMap: Object.fromEntries(Object.entries(s.game.roleMap).map(([r, k]) => [r, k ? idMap.get(k) ?? null : null])) } : undefined,
      };
      void saveSet(set);
      this.sets.unshift(set);
    }
    this.refreshPanel();
  }

  private kitAction(id: string): void {
    const p = this.panel;
    const item = this.kit.find((k) => k.id === p.selectedKit);
    if (id !== 'kit:remove') p.armedRemove = false;
    if (id === 'kit:add') void this.addCurrent();
    else if (id === 'kit:starter') bus.emit('playkit:spawn', {});
    else if (id === 'kit:download') {
      if (input.xr) this.toast('Download works in the browser view');
      else {
        downloadFile('claymind-kit.claymind.json', kitToJson(this.kit, this.sets), 'application/json');
        this.toast(`Downloaded the kit (${this.kit.length} toys, ${this.sets.length} Sets)`);
      }
    } else if (id === 'kit:import') bus.emit('library:import', {});
    else if (!item) return;
    else if (id === 'kit:place') this.placeKit(item);
    else if (id === 'kit:rename') {
      if (input.xr) return this.toast('Rename needs a keyboard: open ClayMind in a browser');
      const name = this.ask('New name', item.name);
      if (name && name !== item.name) {
        item.name = name;
        item.data.creation.name = name;
        void saveKitItem(item);
      }
    } else if (id === 'kit:role') {
      item.role = ROLE_TAGS[(ROLE_TAGS.indexOf(item.role) + 1) % ROLE_TAGS.length];
      void saveKitItem(item);
    } else if (id === 'kit:dup') {
      const copy = makeKitItem(item.data, `${item.name} 2`.slice(0, 40));
      copy.role = item.role;
      void saveKitItem(copy);
      this.kit.push(copy);
      p.selectedKit = copy.id;
    } else if (id === 'kit:remove') {
      const now = performance.now();
      if (!p.armedRemove || now - this.armedAt > CONFIRM_MS) {
        p.armedRemove = true;
        this.armedAt = now;
        this.toast(`Remove "${item.name}" from the Play Kit? Tap again`);
      } else {
        p.armedRemove = false;
        void this.removeKit(item.id);
        offerUndo(`Removed "${item.name}" from the Play Kit`, () => {
          void saveKitItem(item);
          this.kit.push(item);
          this.kit.sort((a, b) => a.addedAt - b.addedAt);
          this.refreshPanel();
        }, input.xr);
      }
    }
    this.refreshPanel();
  }

  // ---------- sets ----------

  private saveTable(): void {
    if (!this.pieces.length) return this.toast('Nothing on the table yet');
    const name = this.ask('Name for this Set', this.setName || `Set ${this.sets.length + 1}`);
    if (name === null) return;
    const pieces: SetPiece[] = [];
    for (const p of this.pieces) {
      const s = this.objects.toyState(p.toyId, this.st);
      if (!s) continue;
      const pose = toSurfaceFrame(surface, this.st.p.toArray() as [number, number, number], this.st.q.toArray() as [number, number, number, number]);
      pieces.push({ kitId: p.kitId, builtin: p.builtin, role: p.key, pose, pinned: p.fixed || (this.mode === 'edit' ? false : s.pinned) });
      p.start = { p: this.st.p.toArray(), q: this.st.q.toArray() }; // Reset returns here now
    }
    const set: PlaySet = {
      schema: KIT_SCHEMA, id: `set_${Date.now().toString(36)}`, name, savedAt: Date.now(), pieces, physics: { gravity: 1 },
      game: this.spec ? { templateId: this.spec.id, roleMap: { ...this.roleMap } } : undefined,
    };
    void saveSet(set);
    this.sets.unshift(set);
    this.setName = name;
    this.refreshPanel();
    this.syncHud();
    this.toast(`Saved the Set "${name}" (${pieces.length} pieces)`);
    uiSounds.chime();
  }

  private openSet(set: PlaySet): void {
    if (this.mode !== 'off') this.end();
    this.enterTable();
    this.spec = set.game ? templateById(set.game.templateId) ?? null : null;
    this.roleMap = set.game ? { ...set.game.roleMap } : {};
    this.setName = set.name;
    let missing = 0;
    for (const sp of set.pieces) {
      const role = this.spec?.roles.find((r) => r.id === sp.role?.split(':')[0]);
      const i = Number(sp.role?.split(':')[1]) || 0;
      const parts = this.partsOf(sp, role ? this.colorFor(role, i) : null);
      if (!parts) {
        missing++;
        continue;
      }
      const w = fromSurfaceFrame(surface, sp.pose.p, sp.pose.q);
      this.spawnWorld(parts, w.p, w.q, true, { kitId: sp.kitId, builtin: sp.builtin, key: role ? sp.role : undefined, role: role?.id, fixed: sp.pinned || !!role?.pinned });
    }
    this.engine = null;
    if (this.spec) this.showZones(this.spec);
    this.mode = 'edit';
    this.hud.rules = this.spec?.howToPlay ?? [];
    this.hud.showRules = !!this.spec;
    this.hud.message = missing ? `${missing} piece(s) missing from the kit` : '';
    this.hud.over = false;
    this.applyMode();
    this.closePanel();
    this.hud.mesh.visible = true;
  }

  private setAction(id: string): void {
    const p = this.panel;
    const set = this.sets.find((s) => s.id === p.selectedSet);
    if (id !== 'set:delete') p.armedRemove = false;
    if (id === 'set:save') this.saveTable();
    else if (!set) return;
    else if (id === 'set:open') this.openSet(set);
    else if (id === 'set:rename') {
      if (input.xr) return this.toast('Rename needs a keyboard: open ClayMind in a browser');
      const name = this.ask('New name', set.name);
      if (name && name !== set.name) {
        set.name = name;
        void saveSet(set);
      }
    } else if (id === 'set:delete') {
      const now = performance.now();
      if (!p.armedRemove || now - this.armedAt > CONFIRM_MS) {
        p.armedRemove = true;
        this.armedAt = now;
        this.toast(`Delete the Set "${set.name}"? Tap again`);
      } else {
        p.armedRemove = false;
        void deleteSet(set.id);
        this.sets = this.sets.filter((s) => s.id !== set.id);
        offerUndo(`Deleted the Set "${set.name}"`, () => {
          void saveSet(set);
          this.sets.unshift(set);
          this.refreshPanel();
        }, input.xr);
      }
    }
    this.refreshPanel();
  }

  // ---------- panel ----------

  private openPanel(): void {
    this.refreshPanel();
    this.panel.mesh.visible = true;
    this.openedAt = performance.now();
    uiSounds.tick();
  }

  private closePanel(): void {
    this.panel.mesh.visible = false;
    this.panel.armedRemove = false;
  }

  private press(id: string): void {
    const p = this.panel;
    this.openedAt = performance.now();
    if (id === 'close') return this.closePanel();
    if (id.startsWith('tab:')) {
      p.tab = id.slice(4) as typeof p.tab;
      p.setup = null;
      p.armedRemove = false;
    } else if (id.startsWith('k:')) {
      p.selectedKit = id.slice(2);
      p.armedRemove = false;
    } else if (id.startsWith('s:')) {
      p.selectedSet = id.slice(2);
      p.armedRemove = false;
    } else if (id.startsWith('g:')) {
      const spec = templateById(id.slice(2));
      if (spec) p.setup = { spec, roleMap: suggestRoleMap(spec, this.kit) };
    } else if (id.startsWith('r:') && p.setup) {
      // cycle: built-in shape, then every kit toy that fits this role (best first)
      const role = p.setup.spec.roles.find((r) => r.id === id.slice(2))!;
      const fits = this.kit.map((k) => [k, fitScore(k, role)] as const).filter(([, s]) => s !== null).sort((a, b) => b[1]! - a[1]!).map(([k]) => k.id);
      const options = [null, ...fits];
      const i = options.indexOf(p.setup.roleMap[role.id] ?? null);
      p.setup.roleMap[role.id] = options[(i + 1) % options.length];
      if (fits.length === 0) this.toast(`No toy in your kit fits "${role.label}" (needs ${role.tags.join(' / ')}, about ${role.fallback} size)`);
    } else if (id === 'setup:back') p.setup = null;
    else if (id === 'setup:play' && p.setup) return this.startGame(p.setup.spec, p.setup.roleMap);
    else if (id.startsWith('kit:')) return this.kitAction(id);
    else if (id.startsWith('set:')) return this.setAction(id);
    uiSounds.tick();
    p.invalidate();
  }

  private hudPress(id: string): void {
    if (id === 'hud:mode') this.setMode(this.mode === 'play' ? 'edit' : 'play');
    else if (id === 'hud:pause') this.setPaused(!this.paused);
    else if (id === 'hud:reset') this.reset();
    else if (id === 'hud:rules') this.hud.showRules = !this.hud.showRules;
    else if (id === 'hud:save') this.saveTable();
    else if (id === 'hud:end') this.end();
    uiSounds.tick();
    this.syncHud();
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (input.xr || e.target !== this.world.renderer.domElement) return;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    for (const [panel, act] of [[this.panel, (id: string) => this.press(id)], [this.hud, (id: string) => this.hudPress(id)]] as const) {
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

  private placePanels(): void {
    const eye = this.world.camera.getWorldPosition(this.v2);
    const xr = input.xr;
    const narrow = (this.world.camera as PerspectiveCamera).aspect < 1.3;
    if (this.panel.mesh.visible) {
      const m = this.panel.mesh;
      const at = this.mode === 'off' ? this.sculpt.clayCenterWorld(this.v) : this.v.copy(this.origin);
      const toEye = this.tip.copy(eye).sub(at).setY(0).normalize();
      m.scale.setScalar(xr ? XR_TEXT_SCALE : 0.5);
      m.position.copy(at).addScaledVector(toEye, xr ? 0.12 : narrow ? 0.16 : 0.14);
      m.position.y += xr ? 0.16 : 0.07;
      m.lookAt(eye);
    }
    if (this.hud.mesh.visible) {
      const m = this.hud.mesh;
      m.scale.setScalar(xr ? XR_TEXT_SCALE : 0.6);
      this.toWorld(xr ? 0.24 : 0.12, xr ? 0.24 : 0.17, xr ? -0.08 : -0.05, m.position);
      m.lookAt(eye);
    }
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.tickGame(dt);
    if (this.hud.message && !this.hud.over && performance.now() - this.messageAt > MESSAGE_MS) {
      this.hud.message = '';
      this.hud.invalidate();
    }
    if (this.panel.mesh.visible && performance.now() - this.openedAt > IDLE_CLOSE_MS) this.closePanel();
    this.placePanels();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const tip = h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null;
      const now = performance.now();
      const a = this.panel.poke(tip, now);
      if (a) this.press(a);
      const b = this.hud.poke(tip, now);
      if (b) this.hudPress(b);
    }
    this.panel.draw();
    this.hud.draw();
  }
}
