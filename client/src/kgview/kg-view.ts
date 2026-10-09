/**
 * 3D rendering of the brain: glowing node spheres with labels, edges as thin
 * tubes (thickness = confidence, colour = source; cut edges faded red,
 * disputed edges pulse red), a grab handle on each edge, a rubber band for
 * connecting, and step-by-step reasoning-path playback.
 */
import {
  CanvasTexture, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from '@iwsdk/core';
import type { KGEdge, KGNode, NodeType } from '../kg/schema.js';
import { SOURCE_COLORS } from '../kg/schema.js';
import type { FocusGraph } from './focus.js';

const TYPE_COLORS: Record<NodeType, number> = {
  Creation: 0xe2733b, Concept: 0x3fb8af, Material: 0xd8c9b0, ShapeFeature: 0x9b7bd4,
  Property: 0x5aa9e6, Behavior: 0xf0b429, Context: 0x999999, Challenge: 0x999999,
};
const NODE_R = 0.011;
const HANDLE_R = 0.008;

interface NodeView {
  node: KGNode;
  group: Group;
  sphere: Mesh;
  mat: MeshStandardMaterial;
  label: Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: CanvasTexture;
  labelText: string;
  target: Vector3;
}

interface EdgeView {
  edge: KGEdge;
  tube: Mesh;
  arrow: Mesh;
  handle: Mesh;
  mat: MeshBasicMaterial;
  handleMat: MeshBasicMaterial;
  baseColor: Color;
  radius: number;
}

const tubeGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
const arrowGeo = new ConeGeometry(1, 1, 8);
const sphereGeo = new SphereGeometry(1, 20, 14);
const handleGeo = new SphereGeometry(1, 12, 8);
const UP = new Vector3(0, 1, 0);
const DISPUTED = new Color(0xff3b30);

export class KGView {
  readonly root = new Group();
  private nodes = new Map<string, NodeView>();
  private edges = new Map<string, EdgeView>();
  private hover: string | null = null;
  private selected: string | null = null;
  private playback: { steps: string[]; t0: number; stepMs: number; onStep?: (i: number) => void; last: number } | null = null;
  private lit = new Set<string>();
  private band: Mesh;
  private v = new Vector3();
  private v2 = new Vector3();
  private predictions = new Map<string, number>();

  constructor() {
    this.band = new Mesh(tubeGeo, new MeshBasicMaterial({ color: 0x5fbf72, transparent: true, opacity: 0.8, depthWrite: false }));
    this.band.visible = false;
    this.root.add(this.band);
  }

  /** Replace the shown subgraph; nodes keep their current position and glide to the new layout. */
  setGraph(fg: FocusGraph, positions: Map<string, [number, number, number]>): void {
    this.predictions = new Map(fg.predictions.map((p) => [p.behaviorId, p.confidence]));
    const keepN = new Set(fg.nodes.map((n) => n.id));
    for (const [id, nv] of this.nodes) if (!keepN.has(id)) this.removeNode(id, nv);
    for (const n of fg.nodes) {
      const pos = positions.get(n.id) ?? [0, 0, 0];
      let nv = this.nodes.get(n.id);
      if (!nv) nv = this.addNode(n, pos);
      nv.node = n;
      nv.target.set(pos[0], pos[1], pos[2]);
      this.drawLabel(nv, n.id === fg.focus);
    }
    const keepE = new Set(fg.edges.map((e) => e.id));
    for (const [id, ev] of this.edges) if (!keepE.has(id)) this.removeEdge(id, ev);
    for (const e of fg.edges) {
      let ev = this.edges.get(e.id);
      if (!ev) ev = this.addEdge(e);
      ev.edge = e;
      this.styleEdge(ev);
    }
  }

  private addNode(n: KGNode, pos: [number, number, number]): NodeView {
    const color = n.type === 'Material' && typeof n.props.color === 'string' ? new Color(n.props.color) : new Color(TYPE_COLORS[n.type]);
    const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 });
    const sphere = new Mesh(sphereGeo, mat);
    sphere.scale.setScalar(n.type === 'Creation' ? NODE_R * 1.4 : NODE_R);
    sphere.userData.kg = { kind: 'node', id: n.id };
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 384;
    labelCanvas.height = 80;
    const labelTex = new CanvasTexture(labelCanvas);
    labelTex.colorSpace = SRGBColorSpace;
    const label = new Sprite(new SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
    label.scale.set(0.09, 0.0188, 1);
    label.position.set(0, -0.022, 0);
    label.renderOrder = 12;
    const group = new Group();
    group.add(sphere, label);
    group.position.set(pos[0], pos[1] + 0.02, pos[2]);
    this.root.add(group);
    const nv: NodeView = { node: n, group, sphere, mat, label, labelCanvas, labelTex, labelText: '', target: new Vector3(...pos) };
    this.nodes.set(n.id, nv);
    return nv;
  }

  private removeNode(id: string, nv: NodeView): void {
    this.root.remove(nv.group);
    nv.mat.dispose();
    nv.labelTex.dispose();
    (nv.label.material as SpriteMaterial).dispose();
    this.nodes.delete(id);
  }

  private addEdge(e: KGEdge): EdgeView {
    const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    const tube = new Mesh(tubeGeo, mat);
    const arrow = new Mesh(arrowGeo, mat);
    const handleMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
    const handle = new Mesh(handleGeo, handleMat);
    handle.scale.setScalar(HANDLE_R);
    handle.userData.kg = { kind: 'edge', id: e.id };
    this.root.add(tube, arrow, handle);
    const ev: EdgeView = { edge: e, tube, arrow, handle, mat, handleMat, baseColor: new Color(), radius: 0.002 };
    this.edges.set(e.id, ev);
    return ev;
  }

  private removeEdge(id: string, ev: EdgeView): void {
    this.root.remove(ev.tube, ev.arrow, ev.handle);
    ev.mat.dispose();
    ev.handleMat.dispose();
    this.edges.delete(id);
  }

  private styleEdge(ev: EdgeView): void {
    const e = ev.edge;
    if (e.status === 'rejected') {
      ev.baseColor.set(0xd9534f);
      ev.mat.opacity = 0.22;
      ev.radius = 0.0012;
    } else {
      ev.baseColor.set(e.relation === 'contradicts' ? 0xd9534f : SOURCE_COLORS[e.source]);
      ev.mat.opacity = 0.85;
      ev.radius = 0.0012 + e.confidence * 0.0026;
    }
    ev.mat.color.copy(ev.baseColor);
  }

  private drawLabel(nv: NodeView, focus: boolean): void {
    const pred = this.predictions.get(nv.node.id);
    const text = pred !== undefined ? `${nv.node.label} · ${Math.round(pred * 100)}%` : nv.node.label;
    const key = `${text}|${focus}`;
    if (key === nv.labelText) return;
    nv.labelText = key;
    const ctx = nv.labelCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 384, 80);
    ctx.font = `${focus ? 700 : 600} 34px system-ui, sans-serif`;
    const w = Math.min(376, ctx.measureText(text).width + 28);
    ctx.fillStyle = focus ? 'rgba(226,115,59,0.9)' : 'rgba(16,18,22,0.72)';
    ctx.beginPath();
    ctx.roundRect((384 - w) / 2, 8, w, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 192, 42, 360);
    nv.labelTex.needsUpdate = true;
  }

  // ---------- interaction helpers ----------

  /** Nearest node or edge handle to a world point within `radius` (m). */
  pick(world: Vector3, radius: number): { kind: 'node' | 'edge'; id: string } | null {
    let best: { kind: 'node' | 'edge'; id: string } | null = null, bestD = radius;
    for (const [id, nv] of this.nodes) {
      nv.sphere.getWorldPosition(this.v);
      const d = this.v.distanceTo(world) - NODE_R;
      if (d < bestD) {
        bestD = d;
        best = { kind: 'node', id };
      }
    }
    for (const [id, ev] of this.edges) {
      ev.handle.getWorldPosition(this.v);
      const d = this.v.distanceTo(world) - HANDLE_R * 0.5;
      if (d < bestD) {
        bestD = d;
        best = { kind: 'edge', id };
      }
    }
    return best;
  }

  /** Meshes for pointer raycasts (userData.kg = { kind, id }). */
  targets(): Mesh[] {
    return [...[...this.nodes.values()].map((n) => n.sphere), ...[...this.edges.values()].map((e) => e.handle)];
  }

  nodeWorld(id: string, out: Vector3): Vector3 | null {
    const nv = this.nodes.get(id);
    return nv ? nv.sphere.getWorldPosition(out) : null;
  }

  edgeHandleWorld(id: string, out: Vector3): Vector3 | null {
    const ev = this.edges.get(id);
    return ev ? ev.handle.getWorldPosition(out) : null;
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  setSelected(id: string | null): void {
    this.selected = id;
  }

  /** Rubber band from a node to a world point (connect gesture); null hides it. */
  setBand(fromNode: string | null, toWorld?: Vector3): void {
    if (!fromNode || !toWorld) {
      this.band.visible = false;
      return;
    }
    const a = this.nodes.get(fromNode)?.group.position;
    if (!a) return;
    this.v2.copy(toWorld);
    this.root.worldToLocal(this.v2);
    this.placeTube(this.band, a, this.v2, 0.0025);
    this.band.visible = true;
  }

  /** Light up a reasoning path step by step (edge ids; nodes light with their edges). */
  playPath(edgeIds: string[], onStep?: (i: number) => void, stepMs = 420): void {
    this.lit.clear();
    this.playback = { steps: edgeIds, t0: performance.now(), stepMs, onStep, last: -1 };
  }

  get playing(): boolean {
    return this.playback !== null;
  }

  // ---------- frame ----------

  update(dt: number, now: number): void {
    const k = 1 - Math.exp(-dt * 10);
    for (const nv of this.nodes.values()) nv.group.position.lerp(nv.target, k);

    if (this.playback) {
      const step = Math.floor((now - this.playback.t0) / this.playback.stepMs);
      if (step !== this.playback.last && step < this.playback.steps.length) {
        this.playback.last = step;
        const id = this.playback.steps[step];
        this.lit.add(id);
        const [from, , to] = id.split('|');
        this.lit.add(from);
        this.lit.add(to);
        this.playback.onStep?.(step);
      }
      if (step >= this.playback.steps.length + 4) {
        this.playback = null;
        this.lit.clear();
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const [id, nv] of this.nodes) {
      const on = this.lit.has(id) || id === this.selected;
      nv.mat.emissiveIntensity = on ? 1.1 : id === this.hover ? 0.8 : this.lit.size ? 0.12 : 0.35;
      const s = (nv.node.type === 'Creation' ? NODE_R * 1.4 : NODE_R) * (id === this.hover || on ? 1.25 : 1);
      nv.sphere.scale.setScalar(s);
    }
    for (const [id, ev] of this.edges) {
      const a = this.nodes.get(ev.edge.from)?.group.position, b = this.nodes.get(ev.edge.to)?.group.position;
      if (!a || !b) continue;
      const lit = this.lit.has(id);
      this.placeTube(ev.tube, a, b, lit ? ev.radius * 1.8 : ev.radius);
      // arrow head near the target, handle at the middle
      this.v.subVectors(b, a);
      const len = this.v.length();
      this.v.normalize();
      ev.arrow.position.copy(a).addScaledVector(this.v, Math.max(0, len - NODE_R * 1.9));
      ev.arrow.quaternion.setFromUnitVectors(UP, this.v);
      ev.arrow.scale.set(ev.radius * 2.6, 0.012, ev.radius * 2.6);
      ev.handle.position.copy(a).add(b).multiplyScalar(0.5);
      const hov = id === this.hover;
      ev.handle.scale.setScalar(HANDLE_R * (hov ? 1.5 : 1));
      ev.handleMat.opacity = hov ? 0.9 : 0.25;
      if (ev.edge.status === 'disputed') ev.mat.color.copy(ev.baseColor).lerp(DISPUTED, pulse);
      else if (lit) ev.mat.color.set(0xffffff);
      else ev.mat.color.copy(ev.baseColor);
      ev.mat.opacity = ev.edge.status === 'rejected' ? 0.22 : this.lit.size && !lit ? 0.25 : 0.85;
    }
  }

  private placeTube(m: Mesh, a: Vector3, b: Vector3, r: number): void {
    this.v.subVectors(b, a);
    const len = this.v.length();
    m.position.copy(a).add(b).multiplyScalar(0.5);
    if (len > 1e-6) m.quaternion.setFromUnitVectors(UP, this.v.divideScalar(len));
    m.scale.set(r, len, r);
  }
}
