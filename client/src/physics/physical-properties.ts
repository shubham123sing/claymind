/**
 * The one source of physical numbers for a creation (plan v3, section 4).
 * Each part is a closed, CCW-wound triangle soup in object-local metres with a
 * material; mass properties are exact for the mesh (signed tetrahedra). The
 * physics body AND every number shown to the player come from this output.
 * Pure: runs in the worker, on the main thread and in tests.
 */
import { getMaterial } from '../materials/materials.js';

export type Vec3 = [number, number, number];
/** Symmetric 3x3 inertia tensor: [xx, yy, zz, xy, xz, yz] (kg·m²). */
export type Inertia6 = [number, number, number, number, number, number];

export interface PartInput {
  id: number;
  materialId: string;
  positions: Float32Array;
}

export interface PartProperties {
  id: number;
  materialId: string;
  /** m³ */
  volume: number;
  /** kg */
  mass: number;
  /** object-local centre of mass (m) */
  com: Vec3;
  /** about the part's own centre of mass */
  inertia: Inertia6;
}

export interface Support {
  /** Contact patch area on the surface (m²); 0 for a point/edge contact. */
  area: number;
  /** Contact polygon (convex, CCW) in surface x/z, relative to the object origin. */
  polygon: [number, number][];
  /** Centre of mass projected onto the surface (x, z). */
  com: [number, number];
  /** Signed distance from the projected COM to the polygon edge (m): > 0 inside = stands, < 0 = tips. */
  margin: number;
  /** Which way it tips (unit x/z) when margin < 0, else [0, 0]. */
  tipDir: [number, number];
}

export interface PhysicalProperties {
  parts: PartProperties[];
  volume: number;
  mass: number;
  com: Vec3;
  /** about the total centre of mass */
  inertia: Inertia6;
  /** Resting on its lowest points in the given orientation (default: as modelled, y up). */
  support: Support;
}

/** Volume, first moment and second-moment covariance of a closed mesh (unit density). */
function integrate(p: Float32Array): { v: number; m1: Vec3; c: number[] } {
  let v = 0;
  const m1: Vec3 = [0, 0, 0];
  // covariance sum (about the origin): sum over tets of det * A Ccanon A^T
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    v += det / 6;
    m1[0] += (det / 24) * (ax + bx + cx);
    m1[1] += (det / 24) * (ay + by + cy);
    m1[2] += (det / 24) * (az + bz + cz);
    const A = [ax, bx, cx, ay, by, cy, az, bz, cz]; // rows = axes, cols = vertices
    for (let r = 0; r < 3; r++)
      for (let s = 0; s < 3; s++) {
        // Ccanon = (1/120) * [[2,1,1],[1,2,1],[1,1,2]]  ->  sum_ij A_ri Ccanon_ij A_sj
        const ar = A.slice(r * 3, r * 3 + 3), as = A.slice(s * 3, s * 3 + 3);
        const sumR = ar[0] + ar[1] + ar[2], sumS = as[0] + as[1] + as[2];
        const dot = ar[0] * as[0] + ar[1] * as[1] + ar[2] * as[2];
        c[r * 3 + s] += (det * (dot + sumR * sumS)) / 120;
      }
  }
  return { v, m1, c };
}

function inertiaFromCovariance(c: number[]): Inertia6 {
  const tr = c[0] + c[4] + c[8];
  return [tr - c[0], tr - c[4], tr - c[8], -c[1], -c[2], -c[5]];
}

/** Covariance of mass `m` about `com` -> shift from origin to com (parallel axis). */
function centred(c: number[], m: number, com: Vec3): number[] {
  const out = c.slice();
  for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) out[r * 3 + s] -= m * com[r] * com[s];
  return out;
}

export function computePhysicalProperties(parts: PartInput[], orientation: [number, number, number, number] = [0, 0, 0, 1]): PhysicalProperties {
  const out: PartProperties[] = [];
  let mass = 0, volume = 0;
  const m1: Vec3 = [0, 0, 0];
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const part of parts) {
    const rho = getMaterial(part.materialId).density;
    const g = integrate(part.positions);
    const v = Math.abs(g.v);
    const sign = g.v < 0 ? -1 : 1; // tolerate inverted winding
    const m = rho * v;
    const com: Vec3 = v > 0 ? [(sign * g.m1[0]) / v, (sign * g.m1[1]) / v, (sign * g.m1[2]) / v] : [0, 0, 0];
    const pc = g.c.map((x) => x * sign * rho);
    out.push({ id: part.id, materialId: part.materialId, volume: v, mass: m, com, inertia: inertiaFromCovariance(centred(pc, m, com)) });
    mass += m;
    volume += v;
    for (let a = 0; a < 3; a++) m1[a] += m * com[a];
    for (let k = 0; k < 9; k++) cov[k] += pc[k];
  }
  const com: Vec3 = mass > 0 ? [m1[0] / mass, m1[1] / mass, m1[2] / mass] : [0, 0, 0];
  return {
    parts: out, volume, mass, com,
    inertia: inertiaFromCovariance(centred(cov, mass, com)),
    support: support(parts.map((p) => p.positions), com, orientation),
  };
}

function rotate(q: [number, number, number, number], x: number, y: number, z: number, o: number[]): void {
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
}

/** Points within this height of the lowest point count as touching the surface. */
const CONTACT_TOL = 0.003;

/**
 * Contact patch and stability when resting on a flat surface in `orientation`.
 * Uses the lowest vertices (within 3 mm) as the contact set.
 */
export function support(meshes: Float32Array[], com: Vec3, orientation: [number, number, number, number] = [0, 0, 0, 1]): Support {
  const r = [0, 0, 0];
  let minY = Infinity;
  for (const p of meshes)
    for (let i = 0; i < p.length; i += 3) {
      rotate(orientation, p[i], p[i + 1], p[i + 2], r);
      if (r[1] < minY) minY = r[1];
    }
  const pts: [number, number][] = [];
  for (const p of meshes)
    for (let i = 0; i < p.length; i += 3) {
      rotate(orientation, p[i], p[i + 1], p[i + 2], r);
      if (r[1] <= minY + CONTACT_TOL) pts.push([r[0], r[2]]);
    }
  rotate(orientation, com[0], com[1], com[2], r);
  const c: [number, number] = [r[0], r[2]];
  const polygon = convexHull2d(pts);
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  area = Math.abs(area) / 2;
  const { margin, tipDir } = marginOf(polygon, c);
  return { area, polygon, com: c, margin, tipDir };
}

/** Andrew's monotone chain, CCW. */
export function convexHull2d(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const x of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], x) <= 1e-12) lower.pop();
    lower.push(x);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const x = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], x) <= 1e-12) upper.pop();
    upper.push(x);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Signed distance of point c to a convex CCW polygon (> 0 inside) and the outward direction if outside. */
function marginOf(poly: [number, number][], c: [number, number]): { margin: number; tipDir: [number, number] } {
  if (poly.length === 0) return { margin: -Infinity, tipDir: [0, 0] };
  let best = Infinity, bx = 0, bz = 0, inside = poly.length >= 3;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez || 1e-12;
    if (poly.length >= 3 && ex * (c[1] - a[1]) - ez * (c[0] - a[0]) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ez) / len2));
    const px = a[0] + ex * t, pz = a[1] + ez * t;
    const d = Math.hypot(c[0] - px, c[1] - pz);
    if (d < best) (best = d), (bx = px), (bz = pz);
  }
  if (inside) return { margin: best, tipDir: [0, 0] };
  const len = Math.hypot(c[0] - bx, c[1] - bz) || 1;
  return { margin: -best, tipDir: [(c[0] - bx) / len, (c[1] - bz) / len] };
}

/** The part that touches the surface first in `orientation` (its lowest vertex is lowest). */
export function contactPart(parts: PartInput[], orientation: [number, number, number, number] = [0, 0, 0, 1]): number {
  const r = [0, 0, 0];
  let best = 0, minY = Infinity;
  parts.forEach((part, idx) => {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      rotate(orientation, p[i], p[i + 1], p[i + 2], r);
      if (r[1] < minY) (minY = r[1]), (best = idx);
    }
  });
  return best;
}

export interface BodyParameters {
  /** Density for the convex-hull collider so that hull volume × density = our mass. */
  density: number;
  /** Object-local centre of mass handed to Havok (PhysicsBody.centerOfMass). */
  centerOfMass: Vec3;
  friction: number;
  restitution: number;
  /** Index of the part that set friction / restitution. */
  contactPart: number;
}

/**
 * IWSDK gives one collider per body, so a multi-material object is one convex
 * hull with our mass and centre of mass; friction and bounce come from the part
 * touching the surface (with the pair rule for that surface).
 */
export function bodyParameters(
  parts: PartInput[], props: PhysicalProperties, hullVolume: number,
  surfaceMaterial: string, frictionScale: (self: string, other: string) => number,
  orientation: [number, number, number, number] = [0, 0, 0, 1],
): BodyParameters {
  const c = contactPart(parts, orientation);
  const m = getMaterial(parts[c]?.materialId ?? 'clay');
  return {
    density: props.mass / Math.max(hullVolume, props.volume, 1e-9),
    centerOfMass: props.com,
    friction: m.friction * frictionScale(m.id, surfaceMaterial),
    restitution: m.restitution,
    contactPart: c,
  };
}

/** Closed axis-aligned box as a CCW triangle soup (tests, primitives). */
export function boxMesh(min: Vec3, max: Vec3): Float32Array {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // outward-facing CCW quads
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return new Float32Array(out);
}
