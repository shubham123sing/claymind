/**
 * Sculpting: clay lump on the work surface, hand/mouse tools, mirror,
 * undo/redo, two-hand rotate/scale, size readout, squish audio, wrist menu,
 * "New piece" (a creation is made of up to 4 joined pieces, each later gets
 * its own material) and "Bring to life" (bake into a physical object, all local).
 */
import { createSystem, DirectionalLight, Entity, Matrix4, Mesh, Quaternion, Vector3 } from '@iwsdk/core';
import { SculptAudio } from '../audio/sculpt-audio.js';
import { bus, Handedness } from '../core/event-bus.js';
import { devAi, devKgView } from '../core/flags.js';
import { settings } from '../core/settings.js';
import { Hud } from '../devtools/hud.js';
import { estimateMaterial, getMaterial, shapePriors } from '../materials/materials.js';
import { Creation, CREATION_SCHEMA_VERSION, newCreationId } from '../objects/creation.js';
import { getTemplate } from '../objects/templates.js';
import type { HandState, Vec3 } from '../platform/input/hand-state.js';
import { input } from '../platform/input/input-system.js';
import { aiEnabled } from '../ai/ai-state.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { Toolbar } from '../ui/toolbar.js';
import { hasUndo, takeUndo } from '../ui/undo-toast.js';
import { MenuItem, WristMenu } from '../ui/wrist-menu.js';
import { ClayView, PIECE_COLORS } from './clay-view.js';
import { SculptClient } from './sculpt-client.js';
import { BrushOp, MAX_PIECES } from './sdf-grid.js';
import { brush, createHandToolState, HandToolState, SculptTool, ToolContext, TOOLS } from './tools.js';

const GRID_SIZE = 0.25;
/**
 * Similarity needed before a template replaces the sculpt. A clean ball sculpt
 * scores ~0.9; a dented lump scored 0.58 for "ball" and should stay the user's own.
 */
const TEMPLATE_THRESHOLD = 0.7;
const SIDES: Handedness[] = ['left', 'right'];

export class SculptSystem extends createSystem({}) {
  private view!: ClayView;
  private rootEntity!: Entity;
  private groundEntity!: Entity;
  private client!: SculptClient;
  private audio = new SculptAudio();
  private hud: Hud | null = null;
  private hands = input.hands;
  private toolState: Record<Handedness, HandToolState> = { left: createHandToolState(), right: createHandToolState() };
  private pinchOnClay: Record<Handedness, boolean> = { left: false, right: false };
  /** Bring-to-life state: while baking the clay "breathes" and tools pause. */
  private baking = false;
  private fade: { from: number; to: number; t0: number; ms: number } | null = null;
  private statusUntil = 0;
  private tool: SculptTool = TOOLS[0];
  private mirror = false;
  private dominant: Handedness = 'right';
  private menu!: WristMenu;
  private toolbar!: Toolbar;
  private resetArmed = -Infinity;
  private surfaceVersion = -1;
  /** Local AABB of the clay surface from the last mesh update. */
  private aabb: number[] | null = null;
  private inv = new Matrix4();
  private v = new Vector3();
  private v2 = new Vector3();
  private head = new Vector3();
  private fwd = new Vector3();
  private clayCenter: Vec3 = [0, 0, 0];
  private strokesThisFrame = 0;
  private twoHand: { startDist: number; startAngle: number; startYaw: number; startScale: number } | null = null;
  private placeTmp = [0, 0];
  private lastToolbarRefresh = 0;
  private frameMs = 16;
  /** Piece colours the player chose (sRGB hex, by piece label); null = the default tint. */
  private chosen: (string | null)[] = PIECE_COLORS.map(() => null);
  /** Paint brush colour (0xRRGGBB). */
  paintColor = 0xd9534f;
  /** The clay piece the player last touched (Color applies to it). */
  private activePiece = 0;
  /** When the clay was last touched (vs objects: decides where Color applies). */
  lastClayTouch = 0;
  private actionTouched = false;
  /** "New piece" pressed: the next Add stroke lays down this piece (null = none). */
  private armedPiece: number | null = null;
  private armedUsed = false;
  /** Clay surface frozen at mouse-press time (see PointerProvider). */
  private dragSnapshot: Mesh[] | null = null;

  init(): void {
    const params = new URLSearchParams(location.search);
    const res = Number(params.get('res') ?? 48);
    this.view = new ClayView();
    this.rootEntity = this.world.createTransformEntity(this.view.root);
    this.groundEntity = this.world.createTransformEntity(this.view.ground);
    for (const c of this.view.cursors) this.world.createTransformEntity(c);
    // key light so the clay's form reads (environment light alone is flat)
    const key = new DirectionalLight(0xfff4e6, 1.6);
    key.position.set(0.5, 2.2, 0.8);
    this.world.createTransformEntity(key);

    const voxel = GRID_SIZE / (res - 1);
    const r = 0.055;
    // lump rests on the grid floor with a flattened base ~1 cm across
    const lump = { x: 0, y: -GRID_SIZE / 2 + voxel + r - 0.012, z: 0, r };
    this.client = new SculptClient(res, GRID_SIZE, lump, (m, resChanged) => {
      this.view.apply(m, resChanged);
      this.aabb = m.aabb;
      this.updateMeasure();
    });

    input.clayRaycast = (ray, dragging) => {
      if (!dragging) this.dragSnapshot = null;
      else if (!this.dragSnapshot) this.dragSnapshot = this.view.snapshot();
      return ray.intersectObjects(this.dragSnapshot ?? this.view.meshes(), false)[0]?.point ?? null;
    };

    const items = this.menuItems();
    this.menu = new WristMenu(items, () => this.audio.tickSound());
    this.world.createTransformEntity(this.menu.root);
    this.toolbar = new Toolbar(
      items,
      'Drag the clay to pull · Shift+drag to poke · drag empty space to turn · N: new piece · C: colour · 5 Paint / 6 Eraser, [ ] brush size · Enter: bring to life · click a piece, then Material (T) · J join / K separate · P pin · O play kit · L library · drag objects (wheel lifts) and release to drop',
      () => this.audio.tickSound(),
    );

    if (params.has('debug')) this.hud = new Hud(this.world);
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        this.toolbar.setVisible(s === 'non-immersive');
        if (s !== 'non-immersive') this.audio.ensure();
        this.surfaceVersion = -1; // re-place clay relative to the new head pose
      }),
      bus.on('ui:toast', (e) => this.showStatus(e.text, 2600, e.color)),
    );
  }

  private menuItems(): MenuItem[] {
    const tools: MenuItem[] = TOOLS.map((t) => ({
      id: t.id, label: t.label, icon: t.icon, color: t.color,
      selected: () => this.tool === t,
      onPress: () => {
        this.tool = t;
      },
    }));
    return [
      { id: 'life', label: 'Bring to life', icon: '✦', color: 0xf0b429, enabled: () => !this.baking, onPress: () => void this.bringToLife() },
      ...tools,
      { id: 'mirror', label: 'Mirror', icon: '⇋', color: 0x9b7bd4, selected: () => this.mirror, onPress: () => (this.mirror = !this.mirror) },
      { id: 'undo', label: 'Undo', icon: '↶', color: 0x888888, enabled: () => hasUndo() || !!this.client?.last?.canUndo, onPress: () => this.undo() },
      { id: 'redo', label: 'Redo', icon: '↷', color: 0x888888, enabled: () => !!this.client?.last?.canRedo, onPress: () => this.client.redo() },
      { id: 'piece', label: 'New piece', icon: '❖', color: 0x7f9cc0, enabled: () => this.freePiece() !== null && !this.baking, onPress: () => this.newPiece() },
      { id: 'material', label: 'Material', icon: '◐', color: 0x5aa9e6, onPress: () => bus.emit('material:toggle', {}) },
      { id: 'color', label: 'Color', icon: '◉', color: 0xf0b429, onPress: () => bus.emit('color:toggle', {}) },
      { id: 'join', label: 'Join', icon: '⊕', color: 0x5fbf72, onPress: () => bus.emit('object:join', {}) },
      { id: 'pin', label: 'Pin / Unpin', icon: '⌖', color: 0xf0b429, onPress: () => bus.emit('object:pin', {}) },
      { id: 'playkit', label: 'Play Kit', icon: '●', color: 0x8d8a85, onPress: () => bus.emit('playkit:toggle', {}) },
      { id: 'kitadd', label: 'Add to Play Kit', icon: '⊞', color: 0x8d8a85, onPress: () => bus.emit('playkit:add', {}) },
      { id: 'ask', label: 'Ask AI', icon: '?', color: 0xb48cf2, onPress: () => bus.emit('helper:toggle', {}) },
      { id: 'library', label: 'Library', icon: '▦', color: 0x7f9cc0, onPress: () => bus.emit('library:toggle', {}) },
      { id: 'libadd', label: 'Add to Library', icon: '＋', color: 0x7f9cc0, onPress: () => bus.emit('library:add', {}) },
      { id: 'settings', label: 'Settings', icon: '⚙', color: 0x8fa3b8, onPress: () => bus.emit('settings:toggle', {}) },
      { id: 'separate', label: 'Separate', icon: '⊘', color: 0xd9534f, onPress: () => bus.emit('object:separate', {}) },
      // three different things, worded and coloured apart: take a copy off the table (blue) vs erase (red)
      { id: 'remove', label: 'Remove from scene', icon: '↧', color: 0x5aa9e6, onPress: () => bus.emit('scene:remove', {}) },
      { id: 'clear', label: 'Clear scene', icon: '⇊', color: 0x5aa9e6, onPress: () => bus.emit('scene:clear', {}) },
      { id: 'delete', label: 'Delete this creation', icon: '🗑', color: 0xd9534f, danger: true, onPress: () => bus.emit('creation:delete', {}) },
      ...(devKgView
        ? [
            { id: 'brain', label: 'Brain', icon: '✱', color: 0x3fb8af, onPress: () => bus.emit('kg:toggle', {}) },
            { id: 'check', label: 'Check beliefs', icon: '⚗', color: 0xf0a040, onPress: () => bus.emit('agent:check', {}) },
            { id: 'mastery', label: 'Mastery', icon: '★', color: 0xe2733b, onPress: () => bus.emit('mastery:toggle', {}) },
          ]
        : []),
      ...(devAi ? [{ id: 'ai', label: 'AI', icon: '✦', color: 0xb48cf2, selected: () => aiEnabled(), onPress: () => bus.emit('ai:toggle', {}) }] : []),
      {
        id: 'reset', label: 'New clay', icon: '◯', color: 0xd9534f,
        selected: () => performance.now() - this.resetArmed < 2500,
        onPress: () => {
          // two presses within 2.5 s: avoids losing work to a stray tap (still undoable)
          if (performance.now() - this.resetArmed < 2500) {
            this.resetArmed = 0;
            this.client.beginAction();
            this.client.push({ op: 'reset', x: 0, y: 0, z: 0, r: 0 });
          } else this.resetArmed = performance.now();
        },
      },
    ];
  }

  /** While a Play Kit Set or game is on the table: the clay is hidden and does not react. */
  suspended = false;

  setSuspended(on: boolean): void {
    this.suspended = on;
    this.view.root.visible = !on;
    this.view.ground.visible = !on;
  }

  /** Undo: a just-deleted creation first (5 s offer), else the last sculpt action. */
  /** The clay's size now (cm: width, height, depth), or null before the first mesh. */
  claySizeCm(): [number, number, number] | null {
    if (!this.aabb) return null;
    const s = this.view.root.scale.x, a = this.aabb;
    return [(a[3] - a[0]) * s * 100, (a[4] - a[1]) * s * 100, (a[5] - a[2]) * s * 100];
  }

  /** Undo for the AI helper's "fix" button (same as the menu's Undo). */
  undoStep(): void {
    this.undo();
  }

  private undo(): void {
    if (!takeUndo()) this.client.undo();
  }

  /** Delete the clay being made: a fresh lump, as one undoable action. */
  clearClay(): boolean {
    if (this.baking || !this.client) return false;
    this.client.beginAction();
    this.client.push({ op: 'reset', x: 0, y: 0, z: 0, r: 0 });
    return true;
  }

  undoClear(): void {
    this.client.undo();
  }

  // ---------- placement & transforms ----------

  private placeClay(): void {
    this.world.camera.getWorldPosition(this.head);
    nearestSurfacePoint(this.head.x, this.head.z, 0.2, this.placeTmp);
    const [x, z] = this.placeTmp;
    this.view.root.position.x = x;
    this.view.root.position.z = z;
    this.view.root.rotation.y = Math.atan2(this.head.x - x, this.head.z - z);
    this.view.ground.position.set(x, surface.topY, z);
    this.snapToSurface();
  }

  /** Keep the clay's flat base on the surface after scaling. */
  private snapToSurface(): void {
    const voxel = GRID_SIZE / (this.client.res - 1);
    this.view.root.position.y = surface.topY + (GRID_SIZE / 2 - voxel / 2) * this.view.root.scale.x;
  }

  private updateMeasure(): void {
    if (!this.aabb) return;
    const s = this.view.root.scale.x;
    const a = this.aabb;
    const w = (a[3] - a[0]) * s, h = (a[4] - a[1]) * s, d = (a[5] - a[2]) * s;
    const top = (a[4] + GRID_SIZE / 2) * s;
    this.view.updateMeasure([w * 100, h * 100, d * 100], Math.max(w, d) / 2, top);
  }

  // ---------- tool context ----------

  private ctx: ToolContext = {
    clayCenter: this.clayCenter,
    beginAction: () => {
      // the stroke that laid down a new piece is finished: back to extending pieces
      if (this.armedUsed) this.armedPiece = null;
      this.actionTouched = false;
      this.client.beginAction();
    },
    nearClay: (p, margin) => {
      if (!this.aabb) return false;
      this.v.set(p[0], p[1], p[2]).applyMatrix4(this.inv);
      const m = margin / this.view.root.scale.x, a = this.aabb;
      return this.v.x > a[0] - m && this.v.x < a[3] + m && this.v.y > a[1] - m && this.v.y < a[4] + m && this.v.z > a[2] - m && this.v.z < a[5] + m;
    },
    stroke: (op: BrushOp, at, radius, delta) => {
      const s = this.view.root.scale.x;
      this.v.set(at[0], at[1], at[2]).applyMatrix4(this.inv);
      let dx = 0, dy = 0, dz = 0;
      if (delta) {
        this.v2.set(at[0] + delta[0], at[1] + delta[1], at[2] + delta[2]).applyMatrix4(this.inv);
        dx = this.v2.x - this.v.x; dy = this.v2.y - this.v.y; dz = this.v2.z - this.v.z;
      }
      const r = radius / s;
      const piece = op === 'add' && this.armedPiece !== null ? this.armedPiece : undefined;
      if (piece !== undefined) this.armedUsed = true;
      // the first touch of a gesture says which piece the player is working on
      if (!this.actionTouched) {
        this.actionTouched = true;
        this.lastClayTouch = performance.now();
        bus.emit(op === 'paint' ? 'clay:painted' : 'clay:touched', {});
        const label = piece ?? this.view.pieceAt(this.v);
        if (label >= 0) this.activePiece = label;
      }
      const rgb = op === 'paint' ? this.paintColor : undefined;
      this.client.push({ op, x: this.v.x, y: this.v.y, z: this.v.z, r, dx, dy, dz, piece, rgb });
      if (this.mirror) this.client.push({ op, x: -this.v.x, y: this.v.y, z: this.v.z, r, dx: -dx, dy, dz, piece, rgb });
      this.strokesThisFrame++;
    },
  };

  // ---------- frame ----------

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.frameMs = this.frameMs * 0.95 + delta * 1000 * 0.05;
    this.updateFadeAndStatus();

    if (this.surfaceVersion !== surface.version) {
      this.surfaceVersion = surface.version;
      this.placeClay();
    }
    this.handleKeys();

    const root = this.view.root;
    const pointer = input.pointer;
    if (pointer?.active() && pointer.orbitDx !== 0) root.rotation.y += pointer.orbitDx * 0.008;
    root.updateMatrixWorld(true);
    this.inv.copy(root.matrixWorld).invert();
    if (this.aabb) {
      const a = this.aabb;
      this.v.set((a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2).applyMatrix4(root.matrixWorld);
      this.clayCenter[0] = this.v.x; this.clayCenter[1] = this.v.y; this.clayCenter[2] = this.v.z;
    }

    const xr = this.world.session != null;
    this.dominant = settings.leftHanded ? 'left' : 'right';
    const offHand: Handedness = this.dominant === 'right' ? 'left' : 'right';
    if (settings.oneHanded) {
      // one-handed: the menu stays open beside the clay (off-hand side), either hand pokes it
      if (xr) {
        this.world.camera.getWorldDirection(this.fwd);
        const side = (settings.leftHanded ? 1 : -1) * 0.2;
        this.v2.set(this.clayCenter[0] - this.fwd.z * side, this.clayCenter[1] + 0.1, this.clayCenter[2] + this.fwd.x * side);
        this.menu.updateFixed(this.v2, [this.hands.left, this.hands.right], this.world.camera, dt, performance.now());
      } else this.menu.root.visible = false;
      if (input.claims[offHand] === 'menu') input.claims[offHand] = null;
    } else {
      // the off hand's palm-up menu is unavailable while that hand holds an object
      const offClaim = input.claims[offHand];
      const offBusy = offClaim !== null && offClaim !== 'menu';
      const menuOpen = xr && !offBusy && this.menu.update(this.hands[offHand], this.hands[this.dominant], this.world.camera, dt, performance.now());
      if (!xr || offBusy) this.menu.root.visible = false;
      if (!offBusy) input.claims[offHand] = menuOpen ? 'menu' : null;
    }

    for (const side of SIDES) {
      const h = this.hands[side];
      if (h.pinchStarted && !input.claims[side]) this.pinchOnClay[side] = this.ctx.nearClay(h.pinchPoint, 0.015);
    }
    const transforming = xr && !this.suspended && this.updateTwoHand();

    this.strokesThisFrame = 0;
    let speed = 0;
    for (const side of SIDES) {
      const h = this.hands[side];
      const usable = h.tracked && h.stableFrames > 3 && !input.claims[side] && !transforming && !this.baking && !this.suspended;
      if (!usable) {
        this.toolState[side].mode = 'idle';
        this.view.setCursor(side === 'left' ? 0 : 1, false);
        continue;
      }
      const before = this.strokesThisFrame;
      this.tool.update(h, this.ctx, this.toolState[side]);
      if (this.strokesThisFrame > before) speed = Math.max(speed, h.speed);
      this.updateCursor(side, h);
    }
    this.client.flush();

    // audio
    this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldDirection(this.fwd);
    if (this.strokesThisFrame > 0) this.audio.sculpting(Math.min(1, 0.4 + speed * 2), speed);
    this.audio.tick(dt, { x: this.clayCenter[0], y: this.clayCenter[1], z: this.clayCenter[2] },
      { x: this.head.x, y: this.head.y, z: this.head.z, fx: this.fwd.x, fy: this.fwd.y, fz: this.fwd.z });

    const now = performance.now();
    if (now - this.lastToolbarRefresh > 200) {
      this.lastToolbarRefresh = now;
      if (!xr) this.toolbar.refresh();
      this.updateHud();
    }
  }

  // ---------- bring to life ----------

  /**
   * Bake the sculpt (worker): match a template or keep the sculpt, estimate the
   * material, hand the object to the object system, then give the user fresh
   * clay (the reset is an undoable action, so Undo brings the sculpt back).
   */
  async bringToLife(): Promise<void> {
    if (this.baking) return;
    this.baking = true;
    const t0 = performance.now();
    this.view.setStatus(devAi ? 'Looking at your sculpt…' : 'Bringing it to life…');
    this.statusUntil = Infinity;
    this.audio.tickSound(1.2);
    const root = this.view.root;
    // plan v4: the player's own shape, never swapped for a template (threshold above any similarity)
    const threshold = devAi ? TEMPLATE_THRESHOLD : Infinity;
    const res = await this.client.bake({ scale: root.scale.x, threshold, pieces: 6, seed: Math.floor(Math.random() * 1e9) });
    if (!res.ok || !res.baked || !res.descriptor) {
      this.showStatus('Shape some clay first, then bring it to life', 3000, '#d9534f');
      this.baking = false;
      return;
    }
    const d = res.descriptor;
    const top = res.ranking[0];
    const tmpl = res.templateId ? getTemplate(res.templateId) : undefined;
    const best = top ? getTemplate(top.id) : undefined;
    const sources = tmpl
      ? [{ priors: tmpl.materialPriors, weight: 1 }, { priors: shapePriors(d), weight: 0.3 }]
      : [{ priors: shapePriors(d), weight: 1 }, ...(best && top.similarity > 0.3 ? [{ priors: best.materialPriors, weight: top.similarity }] : [])];
    // plan v4: every piece starts as clay; the player picks materials (no guessing)
    const guesses = devAi ? estimateMaterial(sources) : [{ id: 'clay', prob: 1 }];
    const mat = getMaterial(guesses[0].id);
    const b = res.baked;
    const creation: Creation = {
      schemaVersion: CREATION_SCHEMA_VERSION,
      id: newCreationId(),
      createdAt: Date.now(),
      descriptor: d,
      name: tmpl ? tmpl.name : devAi ? 'Sculpt' : 'Creation',
      category: tmpl?.category ?? 'sculpt',
      source: tmpl ? 'template' : 'sculpt-only',
      templateId: tmpl?.id ?? null,
      matchScore: top?.similarity ?? 0,
      bestGuess: devAi && best && top.similarity > 0.25 ? { id: best.id, name: best.name, similarity: top.similarity } : null,
      materialId: mat.id,
      materialConfidence: guesses[0].prob,
      materialGuesses: guesses.slice(0, 4),
      parts: b.parts.map((part) => ({
        label: part.label, materialId: mat.id, materialConfidence: guesses[0].prob, by: 'guess' as const, color: this.chosen[part.label] ?? null,
        massKg: mat.density * part.volume, volumeCm3: part.volume * 1e6,
      })),
      massKg: mat.density * b.volume,
      sizeCm: [b.size[0] * 100, b.size[1] * 100, b.size[2] * 100],
      volumeCm3: b.volume * 1e6,
      timeToObject: (performance.now() - t0) / 1000,
      kgNodeIds: [],
    };
    // object pose: sculpt bbox centre in world, clay orientation
    root.updateMatrixWorld(true);
    const p = new Vector3(...d.center).applyMatrix4(root.matrixWorld);
    const q = root.getWorldQuaternion(new Quaternion());
    const pieces = b.parts.length > 1 ? ` · ${b.parts.length} pieces` : '';
    const conf = creation.materialConfidence < 1 ? ` ${Math.round(creation.materialConfidence * 100)}%` : '';
    const guess = `${creation.name}${tmpl ? '?' : ''} · ${mat.name}${conf}${pieces}`;
    this.showStatus(guess, 3500, mat.visual.color);
    bus.emit('creation:baked', {
      creation, baked: b, position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w],
      sculptGeometries: this.view.snapshot().map((m) => m.geometry), scale: root.scale.x, ranking: res.ranking,
    });
    console.info(
      `[life] ${creation.name} (${creation.source}, match ${(creation.matchScore * 100).toFixed(0)}%) ${mat.id} ` +
        `${(creation.massKg * 1000).toFixed(0)} g, ${res.ms.toFixed(0)} ms bake`,
      res.ranking.slice(0, 3),
    );
    // the clay hands off to the object, then a fresh lump fades in
    this.fade = { from: 1, to: 0, t0: performance.now(), ms: 250 };
    setTimeout(() => {
      this.client.beginAction();
      this.client.push({ op: 'reset', x: 0, y: 0, z: 0, r: 0 });
      this.chosen = PIECE_COLORS.map(() => null);
      this.activePiece = 0;
      this.view.setPieceColors(PIECE_COLORS);
      this.fade = { from: 0, to: 1, t0: performance.now(), ms: 600 };
      this.baking = false;
    }, 1400);
  }

  /** The clay piece Color applies to, and its current colour. */
  clayTarget(): { piece: number; color: string; chosen: boolean } {
    const i = this.activePiece;
    return { piece: i, color: this.chosen[i] ?? PIECE_COLORS[i], chosen: this.chosen[i] !== null };
  }

  /** Colour a whole clay piece (null = its default tint). Looks only. */
  setPieceColor(piece: number, color: string | null): void {
    bus.emit('clay:painted', {});
    this.chosen[piece] = color;
    this.view.setPieceColors(this.chosen.map((c, i) => c ?? PIECE_COLORS[i]));
  }

  get toolId(): string {
    return this.tool.id;
  }

  /** World-space centre of the clay. */
  clayCenterWorld(out = new Vector3()): Vector3 {
    return out.set(this.clayCenter[0], this.clayCenter[1], this.clayCenter[2]);
  }

  /** Pick a sculpt tool by id ('paint', 'erase', ...). */
  selectTool(id: string): void {
    this.tool = TOOLS.find((t) => t.id === id) ?? this.tool;
  }

  /** Lowest piece label not in use, or null when all MAX_PIECES exist. */
  private freePiece(): number | null {
    const mask = this.client?.last?.piecesMask ?? 1;
    for (let i = 0; i < MAX_PIECES; i++) if (!(mask & (1 << i))) return i;
    return null;
  }

  /**
   * Start another piece: switches to Add, and the next Add stroke (wherever it
   * starts on the sculpt) lays down clay of the new piece in its own colour.
   * Pieces join where they touch. Later strokes extend whichever piece they touch.
   */
  newPiece(): void {
    const piece = this.freePiece();
    if (piece === null || this.baking) {
      if (piece === null) this.showStatus(`Up to ${MAX_PIECES} pieces`, 2000, '#d9534f');
      return;
    }
    this.armedPiece = piece;
    this.armedUsed = false;
    this.tool = TOOLS.find((t) => t.id === 'add') ?? this.tool;
    this.audio.tickSound(1.4);
    this.showStatus(`Piece ${piece + 1}: add clay where it goes`, 4000, PIECE_COLORS[piece]);
  }

  /** Brush size one step up / down (3 mm - 3 cm). */
  brushSize(dir: number): void {
    brush.size = Math.max(brush.min, Math.min(brush.max, brush.size * (dir > 0 ? 1.35 : 1 / 1.35)));
    this.showStatus(`Brush ${Math.round(brush.size * 2000)} mm`, 1200);
  }

  private showStatus(text: string, ms: number, accent?: string): void {
    this.view.setStatus(text, accent);
    this.statusUntil = performance.now() + ms;
  }

  private updateFadeAndStatus(): void {
    const now = performance.now();
    if (now > this.statusUntil) this.view.setStatus(null);
    if (this.fade) {
      const t = Math.min(1, (now - this.fade.t0) / this.fade.ms);
      this.view.setOpacity(this.fade.from + (this.fade.to - this.fade.from) * t);
      if (t >= 1 && this.fade.to === 1) this.fade = null;
    }
    // gentle "breathing" while the sculpt is being looked at
    const breathe = this.baking && !this.fade && !settings.reducedMotion ? 1 + Math.sin(now / 180) * 0.015 : 1;
    for (const c of this.view.root.children) c.scale.setScalar(breathe);
  }

  private updateCursor(side: Handedness, h: HandState): void {
    const idx = side === 'left' ? 0 : 1;
    const p = h.pointing ? h.indexTip : h.aimPoint;
    const show = (h.pinching || h.pointing || this.ctx.nearClay(p, 0.04)) && this.ctx.nearClay(p, 0.06);
    this.view.setCursor(idx, show, p[0], p[1], p[2], this.tool.cursorRadius, this.tool.color);
  }

  /** Both hands pinching away from the clay: rotate (yaw) and scale the sculpt. */
  private updateTwoHand(): boolean {
    const l = this.hands.left, r = this.hands.right;
    const active = l.tracked && r.tracked && l.pinching && r.pinching && !this.pinchOnClay.left && !this.pinchOnClay.right &&
      !input.claims.left && !input.claims.right;
    if (!active) {
      this.twoHand = null;
      return false;
    }
    const dx = r.pinchPoint[0] - l.pinchPoint[0], dz = r.pinchPoint[2] - l.pinchPoint[2];
    const dist = Math.hypot(dx, r.pinchPoint[1] - l.pinchPoint[1], dz);
    const angle = Math.atan2(dz, dx);
    const root = this.view.root;
    if (!this.twoHand) {
      this.twoHand = { startDist: dist, startAngle: angle, startYaw: root.rotation.y, startScale: root.scale.x };
      return true;
    }
    root.rotation.y = this.twoHand.startYaw - (angle - this.twoHand.startAngle);
    const s = Math.max(0.5, Math.min(2, (this.twoHand.startScale * dist) / Math.max(0.05, this.twoHand.startDist)));
    root.scale.setScalar(s);
    this.snapToSurface();
    this.updateMeasure();
    return true;
  }

  private handleKeys(): void {
    const kb = this.input.keyboard;
    const ctrl = kb.getKeyPressed('ControlLeft') || kb.getKeyPressed('ControlRight') || kb.getKeyPressed('MetaLeft');
    const shift = kb.getKeyPressed('ShiftLeft') || kb.getKeyPressed('ShiftRight');
    if (ctrl && kb.getKeyDown('KeyZ')) shift ? this.client.redo() : this.undo();
    if (ctrl && kb.getKeyDown('KeyY')) this.client.redo();
    TOOLS.forEach((t, i) => {
      if (kb.getKeyDown(`Digit${i + 1}`)) this.tool = t;
    });
    if (kb.getKeyDown('KeyM')) this.mirror = !this.mirror;
    if (kb.getKeyDown('KeyN')) this.newPiece();
    if (kb.getKeyDown('BracketLeft')) this.brushSize(-1);
    if (kb.getKeyDown('BracketRight')) this.brushSize(1);
    if (kb.getKeyDown('KeyC')) bus.emit('color:toggle', {});
    if (kb.getKeyDown('KeyJ')) bus.emit('object:join', {});
    if (kb.getKeyDown('KeyK')) bus.emit('object:separate', {});
    if (kb.getKeyDown('KeyT')) bus.emit('material:toggle', {});
    if (kb.getKeyDown('Enter')) void this.bringToLife();
    if (devKgView && kb.getKeyDown('KeyG')) bus.emit('kg:toggle', {});
    if (devKgView && kb.getKeyDown('KeyB')) bus.emit('agent:check', {});
    if (kb.getKeyDown('KeyP')) bus.emit(devKgView ? 'mastery:toggle' : 'object:pin', {});
    if (kb.getKeyDown('KeyO')) bus.emit('playkit:toggle', {});
    if (kb.getKeyDown('KeyL')) bus.emit('library:toggle', {});
    if (kb.getKeyDown('KeyS') && !ctrl) bus.emit('settings:toggle', {});
    if (kb.getKeyDown('KeyH')) {
      if (this.hud) this.hud.setVisible(!this.hud.visible);
      else this.hud = new Hud(this.world);
    }
  }

  private updateHud(): void {
    const hud = this.hud;
    if (!hud || !hud.visible) return;
    const st = this.client.stats;
    hud.set('frame', `${this.frameMs.toFixed(1)} ms  calls ${this.world.renderer.info.render.calls}`);
    hud.set('sculpt', `res ${this.client.res}  tris ${this.view.triangles}  vol ${((this.client.last?.volume ?? 0) * 1e6 * this.view.root.scale.x ** 3).toFixed(0)} cm³`);
    hud.set('worker', `p50 ${st.workerP50.toFixed(1)}  p90 ${st.workerP90.toFixed(1)} ms  rtt ${st.rttP50.toFixed(1)}  downgrades ${st.downgrades}`);
    hud.set('tool', `${this.tool.label}${this.mirror ? ' + mirror' : ''}  surface ${surface.real ? 'REAL' : 'virtual'} y=${surface.topY.toFixed(2)}`);
    for (const side of SIDES) {
      const h = this.hands[side];
      hud.set(`hand ${side[0]}`, h.tracked ? `${h.pinching ? 'pinch' : h.pointing ? 'point' : h.palmOpen ? 'palm' : '-'}  ${this.toolState[side].mode}` : 'not tracked');
    }
    hud.tick(performance.now());
  }
}
