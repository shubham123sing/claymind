/**
 * The brain in the room: loads / seeds the Knowledge Graph, adds creations,
 * shows the focused part as a 3D graph above the table, and lets the user edit
 * it with hands or mouse:
 *   pinch an edge's handle and pull it away  -> cut (the belief is rejected)
 *   pinch a node and drag onto another node  -> connect (new user belief)
 *   tap a prediction on the card              -> "Why?" (reasoning path lights up)
 * Every edit shows what it changed ("Mug · breaks when dropped 50% -> 13%").
 */
import { createSystem, Matrix4, Mesh, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus, Handedness } from '../core/event-bus.js';
import { Brain, Prediction } from '../kg/brain.js';
import type { Creation } from '../objects/creation.js';
import { input } from '../platform/input/input-system.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { autoSave, loadBrain } from '../storage/kg-repo.js';
import { BrainCard, CardAction } from './brain-card.js';
import { focusGraph, FocusGraph } from './focus.js';
import { KGView } from './kg-view.js';
import { layoutGraph } from './layout.js';

const PICK_RADIUS = 0.03;
const CUT_DISTANCE = 0.06;
const CUT_PIXELS = 50;
const PINCH_GRACE_MS = 200;

type Drag =
  | { kind: 'connect'; from: string; by: Handedness | 'pointer' }
  | { kind: 'cut'; edge: string; by: Handedness | 'pointer'; start: Vector3; startPx?: Vector2 };

export class KGSystem extends createSystem({}) {
  readonly brain = new Brain();
  private view = new KGView();
  private card = new BrainCard();
  private focus: string | null = null;
  private fg: FocusGraph | null = null;
  private visible = false;
  private ready = false;
  private pending: Creation[] = [];
  private drag: Drag | null = null;
  private statusUntil = 0;
  private resetArmedAt = -Infinity;
  private placedVersion = -1;
  private placedXr: boolean | null = null;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private v = new Vector3();
  private v2 = new Vector3();
  private xz = [0, 0];
  private pinchStartAt: Record<Handedness, number> = { left: -Infinity, right: -Infinity };
  /** Browser only: camera pose for sculpting vs. "brain open" (pulled back to frame both). */
  private camHome: { p: Vector3; q: Quaternion } | null = null;
  private camBrain = { p: new Vector3(), q: new Quaternion() };
  private camBlend = 0;

  init(): void {
    this.world.createTransformEntity(this.view.root);
    this.view.root.add(this.card.mesh);
    this.card.mesh.position.set(0.43, 0.02, 0.03);
    this.card.mesh.rotation.y = -0.45;
    this.setVisible(false);

    void loadBrain(this.brain).then((how) => {
      this.ready = true;
      this.cleanupFuncs.push(autoSave(this.brain));
      for (const c of this.pending.splice(0)) this.addCreation(c);
      console.info(`[brain] ${how}: ${this.brain.graph.nodes.size} nodes, ${this.brain.graph.edges.size} edges`);
      this.refresh();
    });
    this.cleanupFuncs.push(
      bus.on('creation:baked', (e) => (this.ready ? this.addCreation(e.creation) : this.pending.push(e.creation))),
      bus.on('object:material-set', (e) => this.edit(() => this.brain.setCreationMaterial(e.creationId, e.materialId), `Material set to ${e.materialId}`)),
      bus.on('object:focus', (e) => {
        const id = `cre:${e.creationId}`;
        if (this.brain.graph.node(id) && this.focus !== id) {
          this.focus = id;
          this.refresh();
        }
      }),
      bus.on('kg:toggle', () => this.setVisible(!this.visible)),
    );
    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    const onUp = (e: PointerEvent) => this.onPointerUp(e);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
    });
  }

  private addCreation(c: Creation): void {
    this.focus = this.brain.addCreation(c);
    this.setVisible(true);
    this.refresh();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    this.view.root.visible = v;
    if (!v) this.cancelDrag();
  }

  // ---------------- model -> view ----------------

  private refresh(): void {
    if (!this.ready) return;
    this.fg = focusGraph(this.brain, this.focus);
    this.focus = this.fg.focus;
    const tallest = Math.max(1, ...[0, 1, 2, 3].map((c) => this.fg!.nodes.filter((n) => colOf(n.type) === c).length));
    const positions = layoutGraph(this.fg.nodes, this.fg.edges, { width: 0.56, height: Math.max(0.26, Math.min(0.42, tallest * 0.032)), bend: 0.06 });
    this.view.setGraph(this.fg, positions);
    const node = this.focus ? this.brain.graph.node(this.focus) : null;
    const made = this.focus ? this.brain.graph.outgoing(this.focus).find((e) => e.relation === 'made_of' && e.status !== 'rejected') : null;
    this.card.set({
      hasFocus: !!node,
      title: node ? `What I think about this ${node.label.toLowerCase()}` : 'The brain (overview)',
      subtitle: node && made ? `made of ${this.brain.graph.node(made.to)?.label.toLowerCase()} (${Math.round(made.confidence * 100)}%, ${made.source})` : `${this.brain.graph.nodes.size} ideas · ${this.brain.graph.edges.size} beliefs`,
      predictions: this.fg.predictions,
      canUndo: this.brain.canUndo(),
    });
  }

  /** Run an edit, then report how the focused predictions changed. */
  private edit(fn: () => unknown, what: string): void {
    if (!this.ready) return;
    const before = new Map((this.focus ? this.brain.predictions(this.focus) : []).map((p) => [p.behaviorId, p] as const));
    fn();
    this.refresh();
    const after = this.fg?.predictions ?? [];
    const changes: string[] = [];
    const ids = new Set([...before.keys(), ...after.map((p) => p.behaviorId)]);
    for (const id of ids) {
      const a = before.get(id)?.confidence ?? 0, b = after.find((p) => p.behaviorId === id)?.confidence ?? 0;
      if (Math.abs(a - b) >= 0.05) changes.push(`${(before.get(id) ?? after.find((p) => p.behaviorId === id) as Prediction).label} ${Math.round(a * 100)}% → ${Math.round(b * 100)}%`);
    }
    if (changes.length) {
      this.showStatus(`${what}: ${changes.slice(0, 2).join(' · ')}`);
      return;
    }
    // nothing moved: say which other reason still supports a prediction whose reasoning changed
    const rerouted = after.find((p) => {
      const old = before.get(p.behaviorId);
      return old && old.path.join() !== p.path.join();
    });
    if (rerouted) {
      const via = rerouted.path
        .map((id) => this.brain.graph.edge(id))
        .filter((e) => e && !e.from.startsWith('cre:'))
        .map((e) => `${this.brain.graph.node(e!.from)?.label} → ${this.brain.graph.node(e!.to)?.label}`)[0];
      this.showStatus(`${what}: "${rerouted.label}" is still ${Math.round(rerouted.confidence * 100)}% because ${via ?? 'another belief'}`);
    } else this.showStatus(`${what}: predictions unchanged (stronger beliefs still support them)`);
  }

  private showStatus(text: string): void {
    this.card.set({ status: text });
    this.statusUntil = performance.now() + 7000;
  }

  private cut(edgeId: string): void {
    const e = this.brain.graph.edge(edgeId);
    if (!e) return;
    const label = `${this.brain.graph.node(e.from)?.label} → ${this.brain.graph.node(e.to)?.label}`;
    if (e.status === 'rejected') {
      this.showStatus(`Already cut: ${label} (Undo edit restores it)`);
      return;
    }
    uiSounds.snip();
    this.edit(() => this.brain.cutEdge(edgeId), `Cut "${label}"`);
  }

  private connect(from: string, to: string): void {
    const e = this.brain.connect(from, to);
    if (!e) {
      uiSounds.bonk();
      const a = this.brain.graph.node(from), b = this.brain.graph.node(to);
      this.showStatus(`Can't link ${a?.type.toLowerCase()} → ${b?.type.toLowerCase()}`);
      this.refresh();
      return;
    }
    // connect already applied; undo it and redo it inside edit() so the diff is reported
    this.brain.undo();
    uiSounds.chime();
    this.edit(() => this.brain.connect(from, to), `Added "${this.brain.graph.node(from)?.label} ${e.relation.replace('_', ' ')} ${this.brain.graph.node(to)?.label}"`);
  }

  private onCard(a: CardAction): void {
    uiSounds.tick();
    if (a.kind === 'why') {
      const p = this.fg?.predictions[a.index];
      if (!p) return;
      this.showStatus(`Why "${p.label}"? ${p.path.length} step${p.path.length === 1 ? '' : 's'} · rules: ${[...new Set(p.rules)].join(', ')}`);
      this.view.playPath(p.path, (i) => uiSounds.tick(i));
    } else if (a.kind === 'undo') {
      this.edit(() => this.brain.undo(), 'Undone');
    } else if (a.kind === 'reset') {
      if (performance.now() - this.resetArmedAt < 3000) {
        this.resetArmedAt = 0;
        this.brain.reset();
        this.focus = null;
        this.refresh();
        this.showStatus('Brain reset to what it knew at the start');
      } else this.resetArmedAt = performance.now();
    } else if (a.kind === 'overview') {
      this.focus = null;
      this.refresh();
    }
  }

  // ---------------- placement ----------------

  /** Above and slightly behind the clay, facing the user; lower in the browser so it fits the view. */
  private place(): void {
    const xr = input.xr;
    if (this.placedVersion === surface.version && this.placedXr === xr) return;
    this.placedVersion = surface.version;
    this.placedXr = xr;
    this.world.camera.getWorldPosition(this.v);
    nearestSurfacePoint(this.v.x, this.v.z, 0.2, this.xz);
    const dx = this.v.x - this.xz[0], dz = this.v.z - this.xz[1];
    const len = Math.hypot(dx, dz) || 1;
    const back = xr ? 0.08 : 0.2;
    const up = xr ? 0.36 : 0.3;
    this.view.root.position.set(this.xz[0] - (dx / len) * back, surface.topY + up, this.xz[1] - (dz / len) * back);
    this.view.root.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  /** Browser: ease the camera back/up while the brain is open so clay, graph and card all fit. */
  private updateBrowserCamera(dt: number): void {
    const cam = this.world.camera;
    if (input.xr) return;
    if (!this.camHome) {
      this.camHome = { p: cam.position.clone(), q: cam.quaternion.clone() };
      // frame the clay (below) and the graph (above it): back 0.32 m, up 0.2 m, aim between them
      this.camBrain.p.copy(this.camHome.p).add(new Vector3(0.1, 0.2, 0.46));
      nearestSurfacePoint(this.camHome.p.x, this.camHome.p.z, 0.2, this.xz);
      const aim = new Vector3(this.xz[0] + 0.1, surface.topY + 0.2, this.xz[1] - 0.1);
      // camera looks down -Z: Matrix4.lookAt(eye, target, up) gives that orientation
      this.camBrain.q.setFromRotationMatrix(new Matrix4().lookAt(this.camBrain.p, aim, new Vector3(0, 1, 0)));
    }
    const target = this.visible ? 1 : 0;
    if (Math.abs(this.camBlend - target) < 1e-3) return;
    this.camBlend += (target - this.camBlend) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.camBlend - target) < 0.002) this.camBlend = target;
    cam.position.lerpVectors(this.camHome.p, this.camBrain.p, this.camBlend);
    cam.quaternion.slerpQuaternions(this.camHome.q, this.camBrain.q, this.camBlend);
  }

  // ---------------- XR hands ----------------

  private updateHands(now: number): void {
    let hoverId: string | null = null;
    for (const side of ['left', 'right'] as const) {
      const h = input.hands[side];
      const mine = input.claims[side] === 'kg';
      if (!h.tracked || (input.claims[side] && !mine)) continue;
      const at = this.v.set(h.pinchPoint[0], h.pinchPoint[1], h.pinchPoint[2]);
      if (!this.drag) {
        const hit = this.view.pick(h.pointing ? this.v2.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : at, PICK_RADIUS);
        if (hit) hoverId = hit.id;
        // the pinch midpoint is still settling (fingers closing + smoothing) when the
        // pinch starts, so accept a grab during its first ~200 ms, not only on that frame
        if (h.pinchStarted) this.pinchStartAt[side] = now;
        if (h.pinching && now - this.pinchStartAt[side] < PINCH_GRACE_MS && !input.claims[side]) {
          const p = this.view.pick(at, PICK_RADIUS);
          if (p) {
            input.claims[side] = 'kg';
            this.drag = p.kind === 'node' ? { kind: 'connect', from: p.id, by: side } : { kind: 'cut', edge: p.id, by: side, start: at.clone() };
            uiSounds.tick();
          }
        }
        continue;
      }
      if (this.drag.by !== side) continue;
      hoverId = this.drag.kind === 'cut' ? this.drag.edge : this.drag.from;
      if (this.drag.kind === 'cut') {
        if (at.distanceTo(this.drag.start) > CUT_DISTANCE) {
          this.cut(this.drag.edge);
          this.drag = null; // claim stays until the pinch ends
        }
      } else {
        this.view.setBand(this.drag.from, at);
        const target = this.view.pick(at, PICK_RADIUS);
        if (target?.kind === 'node' && target.id !== this.drag.from) hoverId = target.id;
      }
      if (h.pinchEnded || !h.pinching) this.finishHandDrag(at);
    }
    for (const side of ['left', 'right'] as const) {
      const h = input.hands[side];
      if (input.claims[side] === 'kg' && !this.drag && (!h.pinching || !h.tracked)) input.claims[side] = null;
    }
    this.view.setHover(hoverId);
    // card poke with either index fingertip
    const dom = input.hands.right.tracked ? input.hands.right : input.hands.left;
    const act = this.card.poke(dom.tracked ? this.v2.set(dom.indexTip[0], dom.indexTip[1], dom.indexTip[2]) : null, now);
    if (act) this.onCard(act);
  }

  private finishHandDrag(at: Vector3): void {
    const d = this.drag;
    this.drag = null;
    this.view.setBand(null);
    if (!d || d.kind !== 'connect') return;
    const target = this.view.pick(at, PICK_RADIUS);
    if (target?.kind === 'node' && target.id !== d.from) this.connect(d.from, target.id);
    else this.select(d.from);
  }

  private select(id: string): void {
    const n = this.brain.graph.node(id);
    if (!n) return;
    if (n.type === 'Creation') {
      this.focus = id;
      this.refresh();
    }
    this.view.setSelected(id);
    const out = this.brain.graph.outgoing(id).filter((e) => e.status !== 'rejected');
    this.showStatus(`${n.label} (${n.type}) · ${out.length} belief${out.length === 1 ? '' : 's'} · drag to another node to connect`);
  }

  private cancelDrag(): void {
    if (this.drag && this.drag.by !== 'pointer') input.claims[this.drag.by] = null;
    this.drag = null;
    this.view.setBand(null);
  }

  // ---------------- mouse ----------------

  private setNdc(e: PointerEvent): void {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.visible || input.xr || e.button !== 0 || e.target !== this.world.renderer.domElement) return;
    this.setNdc(e);
    const hits = this.ray.intersectObjects([...this.view.targets(), this.card.mesh], false);
    if (!hits.length) return;
    e.stopImmediatePropagation();
    const h = hits[0];
    if (h.object === this.card.mesh) {
      const a = h.uv ? this.card.actionAtUv(h.uv) : null;
      if (a) this.onCard(a);
      return;
    }
    const kg = (h.object as Mesh).userData.kg as { kind: 'node' | 'edge'; id: string };
    this.drag = kg.kind === 'node'
      ? { kind: 'connect', from: kg.id, by: 'pointer' }
      : { kind: 'cut', edge: kg.id, by: 'pointer', start: h.point.clone(), startPx: new Vector2(e.clientX, e.clientY) };
    uiSounds.tick();
  }

  private onPointerMove(e: PointerEvent): void {
    if (input.xr || !this.visible) return;
    this.setNdc(e);
    const d = this.drag;
    if (!d) {
      const hit = this.ray.intersectObjects(this.view.targets(), false)[0];
      this.view.setHover(hit ? ((hit.object as Mesh).userData.kg as { id: string }).id : null);
      return;
    }
    if (d.by !== 'pointer') return;
    if (d.kind === 'cut') {
      if (d.startPx && Math.hypot(e.clientX - d.startPx.x, e.clientY - d.startPx.y) > CUT_PIXELS) {
        this.cut(d.edge);
        this.drag = null;
      }
      return;
    }
    // rubber band at the depth of the start node
    const start = this.view.nodeWorld(d.from, this.v);
    if (!start) return;
    const depth = start.distanceTo(this.ray.ray.origin);
    this.view.setBand(d.from, this.v2.copy(this.ray.ray.direction).multiplyScalar(depth).add(this.ray.ray.origin));
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.by !== 'pointer') return;
    this.drag = null;
    this.view.setBand(null);
    if (d.kind !== 'connect') return;
    this.setNdc(e);
    const hit = this.ray.intersectObjects(this.view.targets(), false).find((h) => ((h.object as Mesh).userData.kg as { kind: string }).kind === 'node');
    const to = hit ? ((hit.object as Mesh).userData.kg as { id: string }).id : null;
    if (to && to !== d.from) this.connect(d.from, to);
    else this.select(d.from);
  }

  // ---------------- frame ----------------

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.updateBrowserCamera(dt);
    if (!this.visible) return;
    const now = performance.now();
    this.place();
    if (input.xr) this.updateHands(now);
    if (now > this.statusUntil) this.card.set({ status: '' });
    this.card.set({ resetArmed: now - this.resetArmedAt < 3000, canUndo: this.brain.canUndo() });
    this.view.update(dt, now);
    this.card.draw();
  }
}

function colOf(t: string): number {
  return t === 'Creation' ? 0 : t === 'Property' ? 2 : t === 'Behavior' ? 3 : 1;
}
