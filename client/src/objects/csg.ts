/**
 * Tiny SDF CSG language used by template JSON files. Units: metres, Y up,
 * template origin at the centre of its base. Pure math (worker + tests).
 *
 *   { "prim": "cylinder", "r": 0.04, "h": 0.1, "at": [0, 0.05, 0], "rot": [90, 0, 0] }
 *   { "op": "subtract", "k": 0.002, "a": <node>, "b": <node> }
 *   { "op": "union", "k": 0.004, "children": [<node>, ...] }
 */
export type CsgNode =
  | ({ prim: 'sphere'; r: number } & Xf)
  | ({ prim: 'ellipsoid'; radii: [number, number, number] } & Xf)
  | ({ prim: 'box'; size: [number, number, number]; round?: number } & Xf)
  | ({ prim: 'cylinder'; r: number; h: number; round?: number } & Xf)
  | ({ prim: 'cone'; r1: number; r2: number; h: number } & Xf)
  | ({ prim: 'torus'; R: number; r: number } & Xf)
  | ({ op: 'union' | 'intersect'; k?: number; children: CsgNode[] } & Xf)
  | ({ op: 'subtract'; k?: number; a: CsgNode; b: CsgNode } & Xf);

interface Xf {
  /** Translation (m). */
  at?: [number, number, number];
  /** Euler rotation in degrees (XYZ order). */
  rot?: [number, number, number];
}

/** Compiled evaluator: (x, y, z) -> signed distance. */
export type Sdf = (x: number, y: number, z: number) => number;

function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Inverse of rotation R = Rz*Ry*Rx applied to a point (i.e. R^T p). */
function inverseRotation(rotDeg: [number, number, number]): (x: number, y: number, z: number, out: number[]) => void {
  const [ax, ay, az] = rotDeg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx (three.js 'XYZ' Euler order)
  const m = [
    cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz,
    cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz,
    -sy, sx * cy, cx * cy,
  ];
  return (x, y, z, out) => {
    out[0] = m[0] * x + m[3] * y + m[6] * z;
    out[1] = m[1] * x + m[4] * y + m[7] * z;
    out[2] = m[2] * x + m[5] * y + m[8] * z;
  };
}

export function compile(node: CsgNode): Sdf {
  const inner = compileShape(node);
  if (!node.at && !node.rot) return inner;
  const [tx, ty, tz] = node.at ?? [0, 0, 0];
  const rot = node.rot ? inverseRotation(node.rot) : null;
  const p = [0, 0, 0];
  return (x, y, z) => {
    x -= tx; y -= ty; z -= tz;
    if (rot) {
      rot(x, y, z, p);
      return inner(p[0], p[1], p[2]);
    }
    return inner(x, y, z);
  };
}

function compileShape(n: CsgNode): Sdf {
  if ('prim' in n) {
    switch (n.prim) {
      case 'sphere':
        return (x, y, z) => Math.hypot(x, y, z) - n.r;
      case 'ellipsoid': {
        const [a, b, c] = n.radii;
        // standard bound-corrected ellipsoid approximation (iq)
        return (x, y, z) => {
          const k0 = Math.hypot(x / a, y / b, z / c);
          const k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
          return k1 === 0 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1;
        };
      }
      case 'box': {
        const r = n.round ?? 0;
        const hx = n.size[0] / 2 - r, hy = n.size[1] / 2 - r, hz = n.size[2] / 2 - r;
        return (x, y, z) => {
          const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
          return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
        };
      }
      case 'cylinder': {
        const r = n.round ?? 0;
        const hr = n.r - r, hh = n.h / 2 - r;
        return (x, y, z) => {
          const dx = Math.hypot(x, z) - hr, dy = Math.abs(y) - hh;
          return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
        };
      }
      case 'cone': {
        // capped cone along Y, centred, bottom radius r1, top radius r2
        const { r1, r2, h } = n;
        const hh = h / 2;
        return (x, y, z) => {
          const q = Math.hypot(x, z);
          const t = (y + hh) / h; // 0 at bottom, 1 at top
          const rAt = r1 + (r2 - r1) * Math.min(1, Math.max(0, t));
          const slope = Math.hypot(r1 - r2, h) / h;
          const side = (q - rAt) / slope;
          const cap = Math.abs(y) - hh;
          return Math.max(side, cap);
        };
      }
      case 'torus':
        // ring in the XZ plane
        return (x, y, z) => Math.hypot(Math.hypot(x, z) - n.R, y) - n.r;
    }
  }
  if (n.op === 'subtract') {
    const a = compile(n.a), b = compile(n.b), k = n.k ?? 0;
    return (x, y, z) => smax(a(x, y, z), -b(x, y, z), k);
  }
  const kids = n.children.map(compile), k = n.k ?? 0;
  if (n.op === 'union') {
    return (x, y, z) => {
      let d = kids[0](x, y, z);
      for (let i = 1; i < kids.length; i++) d = smin(d, kids[i](x, y, z), k);
      return d;
    };
  }
  return (x, y, z) => {
    let d = kids[0](x, y, z);
    for (let i = 1; i < kids.length; i++) d = smax(d, kids[i](x, y, z), k);
    return d;
  };
}
