/**
 * Phase 1 sculpting: clay lump on the work surface, hand/mouse tools, mirror,
 * undo/redo, two-hand rotate/scale, size readout, squish audio, wrist menu.
 */
import { createSystem, DirectionalLight, Entity, Matrix4, Mesh, Vector3 } from '@iwsdk/core';
import { SculptAudio } from '../audio/sculpt-audio.js';
import type { Handedness } from '../core/event-bus.js';
import { Hud } from '../devtools/hud.js';
import { createHandState, HandState, InputProvider, Vec3 } from '../platform/input/hand-state.js';
import { PointerProvider } from '../platform/input/pointer-provider.js';
import { XrHandsProvider } from '../platform/input/xr-hands-provider.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { Toolbar } from '../ui/toolbar.js';
import { MenuItem, WristMenu } from '../ui/wrist-menu.js';
import { ClayView } from './clay-view.js';
import { SculptClient } from './sculpt-client.js';
import type { BrushOp } from './sdf-grid.js';
import { createHandToolState, HandToolState, SculptTool, ToolContext, TOOLS } from './tools.js';

const GRID_SIZE = 0.25;
const SIDES: Handedness[] = ['left', 'right'];

export class SculptSystem extends createSystem({}) {
  private view!: ClayView;
  private rootEntity!: Entity;
  private groundEntity!: Entity;
  private client!: SculptClient;
  private audio = new SculptAudio();
  private hud: Hud | null = null;
  private hands: Record<Handedness, HandState> = { left: createHandState('left'), right: createHandState('right') };
  private toolState: Record<Handedness, HandToolState> = { left: createHandToolState(), right: createHandToolState() };
  private pinchOnClay: Record<Handedness, boolean> = { left: false, right: false };
  private providers: InputProvider[] = [];
  private pointer!: PointerProvider;
  private tool: SculptTool = TOOLS[0];
  private mirror = false;
  private dominant: Handedness = 'right';
  private menu!: WristMenu;
  private toolbar!: Toolbar;
  private resetArmed = 0;
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

    this.pointer = new PointerProvider(
      this.world.renderer.domElement,
      this.world.camera,
      (ray, dragging) => {
        if (!dragging) this.dragSnapshot = null;
        else if (!this.dragSnapshot) this.dragSnapshot = this.view.snapshot();
        return ray.intersectObjects(this.dragSnapshot ?? this.view.meshes(), false)[0]?.point ?? null;
      },
      () => this.world.session != null,
    );
    this.providers = [new XrHandsProvider(this.world), this.pointer];

    const items = this.menuItems();
    this.menu = new WristMenu(items, () => this.audio.tickSound());
    this.world.createTransformEntity(this.menu.root);
    this.toolbar = new Toolbar(
      items,
      'Drag the clay to pull · Shift+drag to poke · drag empty space to turn · Ctrl+Z undo',
      () => this.audio.tickSound(),
    );

    if (params.has('debug')) this.hud = new Hud(this.world);
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        this.toolbar.setVisible(s === 'non-immersive');
        if (s !== 'non-immersive') this.audio.ensure();
        this.surfaceVersion = -1; // re-place clay relative to the new head pose
      }),
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
      ...tools,
      { id: 'mirror', label: 'Mirror', icon: '⇋', color: 0x9b7bd4, selected: () => this.mirror, onPress: () => (this.mirror = !this.mirror) },
      { id: 'undo', label: 'Undo', icon: '↶', color: 0x888888, enabled: () => !!this.client?.last?.canUndo, onPress: () => this.client.undo() },
      { id: 'redo', label: 'Redo', icon: '↷', color: 0x888888, enabled: () => !!this.client?.last?.canRedo, onPress: () => this.client.redo() },
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
      this.client.push({ op, x: this.v.x, y: this.v.y, z: this.v.z, r, dx, dy, dz });
      if (this.mirror) this.client.push({ op, x: -this.v.x, y: this.v.y, z: this.v.z, r, dx: -dx, dy, dz });
      this.strokesThisFrame++;
    },
  };

  // ---------- frame ----------

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.frameMs = this.frameMs * 0.95 + delta * 1000 * 0.05;
    for (const p of this.providers) if (p.active()) p.update(this.hands, dt);

    if (this.surfaceVersion !== surface.version) {
      this.surfaceVersion = surface.version;
      this.placeClay();
    }
    this.handleKeys();

    const root = this.view.root;
    if (this.pointer.active() && this.pointer.orbitDx !== 0) root.rotation.y += this.pointer.orbitDx * 0.008;
    root.updateMatrixWorld(true);
    this.inv.copy(root.matrixWorld).invert();
    if (this.aabb) {
      const a = this.aabb;
      this.v.set((a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2).applyMatrix4(root.matrixWorld);
      this.clayCenter[0] = this.v.x; this.clayCenter[1] = this.v.y; this.clayCenter[2] = this.v.z;
    }

    const xr = this.world.session != null;
    const offHand: Handedness = this.dominant === 'right' ? 'left' : 'right';
    const menuOpen = xr && this.menu.update(this.hands[offHand], this.hands[this.dominant], this.world.camera, dt, performance.now());
    if (!xr) this.menu.root.visible = false;

    for (const side of SIDES) {
      const h = this.hands[side];
      if (h.pinchStarted) this.pinchOnClay[side] = this.ctx.nearClay(h.pinchPoint, 0.015);
    }
    const transforming = xr && this.updateTwoHand();

    this.strokesThisFrame = 0;
    let speed = 0;
    for (const side of SIDES) {
      const h = this.hands[side];
      const usable = h.tracked && h.stableFrames > 3 && !(menuOpen && side === offHand) && !transforming;
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

  private updateCursor(side: Handedness, h: HandState): void {
    const idx = side === 'left' ? 0 : 1;
    const p = h.pointing ? h.indexTip : h.aimPoint;
    const show = (h.pinching || h.pointing || this.ctx.nearClay(p, 0.04)) && this.ctx.nearClay(p, 0.06);
    this.view.setCursor(idx, show, p[0], p[1], p[2], this.tool.cursorRadius, this.tool.color);
  }

  /** Both hands pinching away from the clay: rotate (yaw) and scale the sculpt. */
  private updateTwoHand(): boolean {
    const l = this.hands.left, r = this.hands.right;
    const active = l.tracked && r.tracked && l.pinching && r.pinching && !this.pinchOnClay.left && !this.pinchOnClay.right;
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
    if (ctrl && kb.getKeyDown('KeyZ')) shift ? this.client.redo() : this.client.undo();
    if (ctrl && kb.getKeyDown('KeyY')) this.client.redo();
    TOOLS.forEach((t, i) => {
      if (kb.getKeyDown(`Digit${i + 1}`)) this.tool = t;
    });
    if (kb.getKeyDown('KeyM')) this.mirror = !this.mirror;
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
