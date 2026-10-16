/**
 * How a creation's pieces become one physics body: a compound of one convex hull (or box
 * set) per piece, each with its material's friction and restitution, densities scaled so
 * the body weighs exactly what the material table says, and the true centre of mass.
 * Shared by the game (object-system.ts) and the headless simulator (src/sim), so a
 * simulated object behaves exactly like the real one. Pure maths: safe in a worker.
 */
import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { matchup, SURFACE_MATERIAL } from '../materials/matchups.js';
import { getMaterial } from '../materials/materials.js';
import type { PartCollider } from '../objects/collider.js';
import { computePhysicalProperties, contactPart, type PhysicalProperties } from './physical-properties.js';
import type { CompoundChild } from './runtime/compound-format.js';

export interface Frame {
  p: [number, number, number] | number[];
  q: [number, number, number, number] | number[];
}

export interface BodyPart {
  materialId: string;
  mesh: { positions: Float32Array };
  collider?: PartCollider;
  frame: Frame;
}

/** A piece's vertices in the object's frame. */
export function toBody(positions: Float32Array, f: Frame): Float32Array {
  const [px, py, pz] = f.p, [qx, qy, qz, qw] = f.q;
  if (px === 0 && py === 0 && pz === 0 && qw === 1) return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    // v' = v + 2w(q x v) + 2 q x (q x v)
    const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x;
    out[i] = x + 2 * qw * cx + 2 * (qy * cz - qz * cy) + px;
    out[i + 1] = y + 2 * qw * cy + 2 * (qz * cx - qx * cz) + py;
    out[i + 2] = z + 2 * qw * cz + 2 * (qx * cy - qy * cx) + pz;
  }
  return out;
}

/** Convex hull points of (up to 256 of) a piece's vertices. */
export function hullOf(positions: Float32Array): PartCollider {
  const n = positions.length / 3, stride = Math.max(1, Math.floor(n / 256)), pts: number[] = [];
  for (let i = 0; i < n; i += stride) pts.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  return { kind: 'hull', points: new Float32Array(pts), volume: 0 };
}

/** Volume of the convex hull of (a subsample of) the vertices, m^3. */
export function hullVolume(positions: Float32Array): number {
  const n = positions.length / 3;
  const stride = Math.max(1, Math.floor(n / 1500));
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i += stride) pts.push(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  if (pts.length < 4) return 0;
  const hull = new ConvexHull().setFromPoints(pts);
  let v = 0;
  for (const face of hull.faces) {
    // fan-triangulate the face loop and sum signed tetrahedra against the origin
    const e0 = face.edge;
    const a = e0.head().point;
    let e = e0.next;
    while (e.next !== e0) {
      const b = e.head().point, c = e.next.head().point;
      v += a.dot(b.clone().cross(c)) / 6;
      e = e.next;
    }
  }
  return Math.abs(v);
}

/** One compound child per piece: its collider and material, density scaled so the body's mass is the true mass. */
export function compoundChild(part: BodyPart, trueVolume: number): CompoundChild {
  const mat = getMaterial(part.materialId);
  const c = part.collider ?? hullOf(part.mesh.positions);
  const data = c.kind === 'hull' ? c.points : c.boxes;
  const volume = c.kind === 'hull' ? hullVolume(c.points) : c.volume;
  return {
    kind: c.kind,
    density: (mat.density * trueVolume) / Math.max(volume, trueVolume * 0.2, 1e-9),
    friction: mat.friction * matchup(mat.id, SURFACE_MATERIAL.table).friction,
    restitution: mat.restitution,
    data,
    frame: part.frame as CompoundChild['frame'],
  };
}

export interface BuiltBody {
  children: CompoundChild[];
  props: PhysicalProperties;
  /** Piece touching the surface: its material sets the body's own friction / restitution. */
  contact: number;
  friction: number;
  restitution: number;
  bodyPositions: Float32Array[];
}

/** Everything the physics engine needs for one object, oriented as `q`. */
export function buildBody(parts: BodyPart[], q: [number, number, number, number] = [0, 0, 0, 1]): BuiltBody {
  const bodyPositions = parts.map((p) => toBody(p.mesh.positions, p.frame));
  const inputs = parts.map((p, i) => ({ id: i, materialId: p.materialId, positions: bodyPositions[i] }));
  const props = computePhysicalProperties(inputs, q);
  const children = parts.map((p, i) => compoundChild(p, props.parts[i].volume));
  const contact = contactPart(inputs, q);
  const m = getMaterial(parts[contact].materialId);
  return { children, props, contact, friction: m.friction, restitution: m.restitution, bodyPositions };
}

export const BODY_DAMPING = { linear: 0.02, angular: 0.08 };
