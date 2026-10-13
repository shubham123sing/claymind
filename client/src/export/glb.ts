/**
 * Library item -> GLB (binary glTF 2.0) for other developers' games (Unity,
 * Unreal, Godot, Blender, three.js):
 * - one node per piece, `piece_<n>_<materialId>`, under a root node named after the creation;
 * - one PBR material per piece (base colour = the piece colour, roughness /
 *   metalness / opacity from its material type);
 * - painted pieces carry the paint as vertex colours (COLOR_0) on a white base
 *   colour, so viewers that multiply the two show the true colours;
 * - welded vertices, no degenerate triangles, metres, Y-up, origin at the
 *   centre of the base;
 * - physics on the root node's extras: `claymind.{schemaVersion, pieces[{id,
 *   materialId, massKg, density, friction, restitution}], totalMassKg, centerOfMass}`;
 * - the licence choice in `asset.copyright`.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial } from '../materials/materials.js';
import { computePhysicalProperties } from '../physics/physical-properties.js';
import type { SavedCreation, SavedPart } from '../storage/library.js';

export const EXPORT_SCHEMA = 1;
export type Licence = 'cc0' | 'reserved';

export const COPYRIGHT: Record<Licence, string> = {
  cc0: 'CC0 1.0 Universal (public domain dedication): anyone may use this, for any purpose. Made with ClayMind.',
  reserved: 'All rights reserved by the creator. Made with ClayMind.',
};

export interface ExportPhysics {
  schemaVersion: number;
  name: string;
  pieces: { id: number; materialId: string; massKg: number; density: number; friction: number; restitution: number }[];
  totalMassKg: number;
  centerOfMass: [number, number, number];
}

/** Piece vertices in the object's frame (applies the piece frame). */
function toBody(p: SavedPart): Float32Array {
  const q = new Quaternion().fromArray(p.frame.q), v = new Vector3(), src = p.mesh.positions, out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    v.set(src[i], src[i + 1], src[i + 2]).applyQuaternion(q);
    out[i] = v.x + p.frame.p[0]; out[i + 1] = v.y + p.frame.p[1]; out[i + 2] = v.z + p.frame.p[2];
  }
  return out;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Welded, indexed geometry without zero-area triangles; paint as linear vertex colours if the piece has any. */
export function cleanGeometry(p: SavedPart): { geometry: BufferGeometry; painted: boolean } {
  const n = p.mesh.positions.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.mesh.positions.slice(), 3));
  const paint = p.mesh.paint;
  const painted = !!paint && paint.some((_, i) => i % 4 === 3 && paint[i] > 0);
  if (painted) {
    const base = new Color(p.color ?? getMaterial(p.materialId).visual.color), c = new Color(), col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const k = paint![v * 4 + 3] > 0 ? c.setRGB(paint![v * 4] / 255, paint![v * 4 + 1] / 255, paint![v * 4 + 2] / 255, 'srgb') : base;
      col[v * 3] = k.r; col[v * 3 + 1] = k.g; col[v * 3 + 2] = k.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
  }
  const welded = mergeVertices(g, 1e-5);
  g.dispose();
  const pos = welded.getAttribute('position'), idx = welded.getIndex()!;
  const keep: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-18) continue; // zero area
    keep.push(i0, i1, i2);
  }
  welded.setIndex(keep);
  welded.computeVertexNormals();
  return { geometry: welded, painted };
}

/** The scene that becomes the GLB (also used by tests). */
export function buildExportScene(s: SavedCreation): { root: Group; physics: ExportPhysics } {
  const body = s.parts.map(toBody);
  let minY = Infinity;
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const pts of body) {
    for (let i = 0; i < pts.length; i += 3) {
      lo[0] = Math.min(lo[0], pts[i]); hi[0] = Math.max(hi[0], pts[i]);
      lo[1] = Math.min(lo[1], pts[i + 2]); hi[1] = Math.max(hi[1], pts[i + 2]);
      minY = Math.min(minY, pts[i + 1]);
    }
  }
  const origin = [(lo[0] + hi[0]) / 2, minY, (lo[1] + hi[1]) / 2];
  const props = computePhysicalProperties(s.parts.map((p, i) => ({ id: i, materialId: p.materialId, positions: body[i] })));

  const root = new Group();
  root.name = s.creation.name || 'ClayMind creation';
  s.parts.forEach((p, i) => {
    const m = getMaterial(p.materialId);
    const { geometry, painted } = cleanGeometry(p);
    const material = new MeshStandardMaterial({
      name: m.id,
      color: painted ? 0xffffff : new Color(p.color ?? m.visual.color),
      vertexColors: painted,
      roughness: m.visual.roughness,
      metalness: m.visual.metalness,
      transparent: m.visual.opacity < 1,
      opacity: m.visual.opacity,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = `piece_${i + 1}_${m.id}`;
    mesh.position.set(p.frame.p[0] - origin[0], p.frame.p[1] - origin[1], p.frame.p[2] - origin[2]);
    mesh.quaternion.fromArray(p.frame.q);
    root.add(mesh);
  });
  const physics: ExportPhysics = {
    schemaVersion: EXPORT_SCHEMA,
    name: root.name,
    pieces: props.parts.map((pp, i) => {
      const m = getMaterial(s.parts[i].materialId);
      return { id: i + 1, materialId: m.id, massKg: r6(pp.mass), density: m.density, friction: m.friction, restitution: m.restitution };
    }),
    totalMassKg: r6(props.mass),
    centerOfMass: [r6(props.com[0] - origin[0]), r6(props.com[1] - origin[1]), r6(props.com[2] - origin[2])],
  };
  root.userData = { claymind: physics };
  return { root, physics };
}

export function exportGlb(s: SavedCreation, licence: Licence): Promise<ArrayBuffer> {
  const { root } = buildExportScene(s);
  const exporter = new GLTFExporter();
  exporter.register((writer) => ({
    afterParse: () => {
      (writer as unknown as { json: { asset: Record<string, string> } }).json.asset.copyright = COPYRIGHT[licence];
    },
  }));
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true });
  }).finally(() => dispose(root));
}

function dispose(root: Group): void {
  for (const m of root.children as Mesh[]) {
    m.geometry.dispose();
    (m.material as MeshStandardMaterial).dispose();
  }
}
