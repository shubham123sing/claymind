/**
 * How a compound collider (one child per piece, each with its own material)
 * travels through IWSDK 1.0.1: IWSDK only sends a ConvexHull's vertex buffer
 * to the physics worker, so the description is packed into that buffer behind
 * a magic header. The extended runtime (physics-runtime-ext.ts) recognises it
 * and builds a Havok container shape; nothing else in IWSDK changes.
 * Pure: shared by the main thread, the worker and tests.
 *
 * Layout (float32): MAGIC_A, MAGIC_B, VERSION, childCount, then per child:
 *   kind (0 hull, 1 boxes), density, friction, restitution, count,
 *   frame (px, py, pz, qx, qy, qz, qw: child-local -> body-local),
 *   hull: count points (x, y, z) · boxes: count boxes (cx, cy, cz, sx, sy, sz)
 * padded with zeros to a multiple of 3 floats.
 */

const MAGIC_A = 1.2345e30;
const MAGIC_B = -6.789e29;
const VERSION = 2;

export interface CompoundChild {
  kind: 'hull' | 'boxes';
  density: number;
  friction: number;
  restitution: number;
  /** hull: points xyz; boxes: centre xyz + full size xyz per box (child-local) */
  data: Float32Array;
  /** Where the child sits in the body (default: identity). */
  frame?: { p: [number, number, number]; q: [number, number, number, number] };
}

export function encodeCompound(children: CompoundChild[]): Float32Array {
  let n = 4;
  for (const c of children) n += 12 + c.data.length;
  const out = new Float32Array(Math.ceil(n / 3) * 3);
  out[0] = MAGIC_A; out[1] = MAGIC_B; out[2] = VERSION; out[3] = children.length;
  let o = 4;
  for (const c of children) {
    out[o++] = c.kind === 'hull' ? 0 : 1;
    out[o++] = c.density;
    out[o++] = c.friction;
    out[o++] = c.restitution;
    out[o++] = c.kind === 'hull' ? c.data.length / 3 : c.data.length / 6;
    const f = c.frame ?? { p: [0, 0, 0], q: [0, 0, 0, 1] };
    out.set(f.p, o);
    out.set(f.q, o + 3);
    o += 7;
    out.set(c.data, o);
    o += c.data.length;
  }
  return out;
}

export function isCompound(v: Float32Array): boolean {
  return v.length >= 6 && v[0] === Math.fround(MAGIC_A) && v[1] === Math.fround(MAGIC_B) && v[2] === VERSION;
}

export function decodeCompound(v: Float32Array): CompoundChild[] {
  const out: CompoundChild[] = [];
  const count = v[3];
  let o = 4;
  for (let i = 0; i < count; i++) {
    const kind = v[o] === 0 ? 'hull' : 'boxes';
    const density = v[o + 1], friction = v[o + 2], restitution = v[o + 3], n = v[o + 4];
    const frame = { p: [v[o + 5], v[o + 6], v[o + 7]] as [number, number, number], q: [v[o + 8], v[o + 9], v[o + 10], v[o + 11]] as [number, number, number, number] };
    o += 12;
    const len = kind === 'hull' ? n * 3 : n * 6;
    out.push({ kind, density, friction, restitution, data: v.slice(o, o + len), frame });
    o += len;
  }
  return out;
}

/** BroadcastChannel name for collision events from the physics worker. */
export const CONTACT_CHANNEL = 'claymind-physics-contacts';

/**
 * One collision start, as posted by the worker. Handles are IWSDK's body
 * handles (PhysicsBody._engineBody); a static body (table, floor) has its handle too.
 */
export interface ContactMessage {
  a: number;
  b: number;
  /** N·s */
  impulse: number;
  /** world contact point on A */
  p: [number, number, number];
  /** contact normal (world) */
  n: [number, number, number];
}
