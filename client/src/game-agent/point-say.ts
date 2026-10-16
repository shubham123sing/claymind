/**
 * Point + Say (V5): what the player's hands show while they describe a game, in code (exact,
 * no camera: the Quest Browser gives web apps no camera feed).
 * - point: the index finger rests on one item for 0.3 s (a ray from the fingertip); in the
 *   browser view, the mouse resting on it;
 * - hold / holdup: an item picked up; held above about shoulder height;
 * - tap: the fingertip touches an item;
 * - zone / path (while marking): a pinch dragged on the table draws a region (a loop, fitted to
 *   a circle) or a route; shown on the table, in the play area's frame.
 * Every gesture is time-stamped for the binder (binder.ts). Items are Play Kit pieces on the
 * table (`toy:<id>`) or creations (`c:<id>`).
 */
import { BufferGeometry, createSystem, Line, LineBasicMaterial, PerspectiveCamera, Vector2, Vector3 } from '@iwsdk/core';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { surface } from '../platform/surface/surface-system.js';
import { PlayKitSystem } from '../playkit/playkit-system.js';
import type { Attention } from './binder.js';
import { fitZone, itemKey, simplifyPath, type Mark } from './marks.js';

const DWELL_MS = 300;
const REPEAT_MS = 1500;
const STEP_M = 0.015;

export type { Mark };

export class PointSaySystem extends createSystem({}) {
  /** A describe session is open (gestures are being recorded). */
  active = false;
  /** Pinch-dragging on the table draws this. */
  marking: 'zone' | 'path' | null = null;
  readonly attention: Attention[] = [];
  readonly marks: Mark[] = [];
  private dwell: Record<'left' | 'right', { key: string | null; since: number; sent: number }> = { left: { key: null, since: 0, sent: 0 }, right: { key: null, since: 0, sent: 0 } };
  private touched: Record<'left' | 'right', string | null> = { left: null, right: null };
  private held = new Set<string>();
  private heldUp = new Set<string>();
  private stroke: { side: 'left' | 'right'; pts: [number, number, number][]; line: Line } | null = null;
  private drawn: Line[] = [];
  private v = new Vector3();
  private d = new Vector3();
  private head = new Vector3();
  private mouse = new Vector2();
  private mouseIn = false;
  private mouseDwell = { key: null as string | null, since: 0, sent: 0 };

  init(): void {
    const move = (e: PointerEvent) => {
      const c = this.world.renderer.domElement;
      if (e.target !== c) return void (this.mouseIn = false);
      const r = c.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouseIn = true;
    };
    addEventListener('pointermove', move);
    this.cleanupFuncs.push(() => removeEventListener('pointermove', move));
  }

  /** The same item for DWELL_MS: a point (again every REPEAT_MS while it stays), and it glows. */
  private dwellOn(dw: { key: string | null; since: number; sent: number }, key: string | null, now: number): void {
    if (key !== dw.key) return void Object.assign(dw, { key, since: now });
    if (!key || now - dw.since < DWELL_MS || now - dw.sent < REPEAT_MS) return;
    dw.sent = now;
    this.push({ t: now, gesture: 'point', itemId: key });
    const id = key.slice(key.indexOf(':') + 1);
    this.objects.highlight(key.startsWith('toy:') ? { toyId: id } : { creationId: id });
  }

  private get objects() {
    return this.world.getSystem(ObjectSystem)!;
  }

  private get kit() {
    return this.world.getSystem(PlayKitSystem)!;
  }

  begin(): void {
    this.active = true;
    this.attention.length = 0;
    this.held = new Set(this.objects.heldItems().map(itemKey).filter((k): k is string => !!k));
    this.heldUp.clear();
  }

  end(): void {
    this.active = false;
    this.marking = null;
    this.cancelStroke();
  }

  clearMarks(): void {
    for (const l of this.drawn) this.disposeLine(l);
    this.drawn = [];
    this.marks.length = 0;
  }

  /** The item pointed at and the items held right now (the binder's fallback). */
  now(): { pointed: string | null; held: string[] } {
    const pointed = [this.dwell.right, this.dwell.left, this.mouseDwell].map((d) => (d.key && performance.now() - d.since >= DWELL_MS ? d.key : null)).find((k) => !!k) ?? null;
    return { pointed, held: [...this.held] };
  }

  private push(a: Attention): void {
    this.attention.push(a);
    if (this.attention.length > 200) this.attention.shift();
  }

  private line(pts: Vector3[], color: number): Line {
    const l = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
    l.renderOrder = 31;
    l.raycast = () => {};
    this.world.scene.add(l);
    return l;
  }

  private disposeLine(l: Line): void {
    l.removeFromParent();
    l.geometry.dispose();
    (l.material as LineBasicMaterial).dispose();
  }

  private cancelStroke(): void {
    if (this.stroke) this.disposeLine(this.stroke.line);
    if (this.stroke) input.claims[this.stroke.side] = null;
    this.stroke = null;
  }

  private onTable(p: ArrayLike<number>): boolean {
    return Math.abs(p[1] - surface.topY) < 0.05;
  }

  update(): void {
    if (!this.active) return;
    const now = performance.now();
    this.world.camera.getWorldPosition(this.head);
    const objects = this.objects;
    // hold / hold up
    const heldNow = new Map(objects.heldItems().map((h) => [itemKey(h), h] as const));
    for (const [key, h] of heldNow) {
      if (!key) continue;
      if (!this.held.has(key)) this.push({ t: now, gesture: 'hold', itemId: key });
      const palm = input.hands[h.side].palmCenter;
      if (!this.heldUp.has(key) && palm[1] > this.head.y - 0.15) {
        this.heldUp.add(key);
        this.push({ t: now, gesture: 'holdup', itemId: key });
      }
    }
    this.held = new Set([...heldNow.keys()].filter((k): k is string => !!k));
    for (const k of [...this.heldUp]) if (!this.held.has(k)) this.heldUp.delete(k);

    // the browser view: the mouse resting on an item points at it
    if (!input.xr && this.mouseIn) {
      const cam = this.world.camera as PerspectiveCamera;
      cam.getWorldPosition(this.v);
      this.d.set(this.mouse.x, this.mouse.y, 0.5).unproject(cam).sub(this.v).normalize();
      this.dwellOn(this.mouseDwell, itemKey(objects.pickAlongRay(this.v, this.d)), now);
    }
    for (const side of ['left', 'right'] as const) {
      const h = input.hands[side];
      if (!h.tracked) continue;
      // point: a ray from the fingertip, away from the palm
      const dw = this.dwell[side];
      if (h.pointing && !h.pinching) {
        this.v.fromArray(h.indexTip as number[]);
        this.d.set(h.indexTip[0] - h.palmCenter[0], h.indexTip[1] - h.palmCenter[1], h.indexTip[2] - h.palmCenter[2]).normalize();
        this.dwellOn(dw, itemKey(objects.pickAlongRay(this.v, this.d)), now);
      } else dw.key = null;
      // tap: the fingertip touches an item
      const touch = h.pinching ? null : itemKey(objects.touchedItem(h.indexTip));
      if (touch && touch !== this.touched[side]) this.push({ t: now, gesture: 'tap', itemId: touch });
      this.touched[side] = touch;
      // marking a zone or a path on the table
      if (this.marking && h.pinchStarted && !input.claims[side] && this.onTable(h.pinchPoint) && !objects.touchedItem(h.pinchPoint, 0.02)) {
        this.cancelStroke();
        input.claims[side] = 'mark';
        this.stroke = { side, pts: [this.kit.toPlayFrame(this.v.fromArray(h.pinchPoint as number[]))], line: this.line([], 0x9fd0f5) };
      }
      const st = this.stroke;
      if (st && st.side === side) {
        if (h.pinching) {
          const p = this.kit.toPlayFrame(this.v.fromArray(h.pinchPoint as number[])), last = st.pts[st.pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[2] - last[2]) > STEP_M) {
            st.pts.push([p[0], 0, p[2]]);
            st.line.geometry.dispose();
            st.line.geometry = new BufferGeometry().setFromPoints(st.pts.map((q) => this.kit.fromPlayFrame([q[0], 0.004, q[2]])));
          }
        } else this.finishStroke(now);
      }
    }
  }

  private finishStroke(now: number): void {
    const st = this.stroke!;
    this.disposeLine(st.line);
    input.claims[st.side] = null;
    this.stroke = null;
    if (this.marking === 'zone') {
      const z = fitZone(st.pts);
      if (!z) return;
      const id = `z${this.marks.filter((m) => m.kind === 'zone').length + 1}`;
      this.marks.push({ id, kind: 'zone', points: st.pts, ...z });
      const ring: Vector3[] = [];
      for (let i = 0; i <= 32; i++) ring.push(this.kit.fromPlayFrame([z.center[0] + Math.cos((i / 32) * Math.PI * 2) * z.radius, 0.004, z.center[2] + Math.sin((i / 32) * Math.PI * 2) * z.radius]));
      this.drawn.push(this.line(ring, 0xf0b429));
      this.push({ t: now, gesture: 'zone', zone: id });
    } else {
      if (st.pts.length < 3) return;
      const pts = simplifyPath(st.pts);
      const id = `p${this.marks.filter((m) => m.kind === 'path').length + 1}`;
      const c: [number, number, number] = [0, 0, 0];
      for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
      this.marks.push({ id, kind: 'path', points: pts, center: c, radius: 0 });
      this.drawn.push(this.line(pts.map((q) => this.kit.fromPlayFrame([q[0], 0.004, q[2]])), 0x9fd0f5));
      this.push({ t: now, gesture: 'path', path: id });
    }
  }
}
