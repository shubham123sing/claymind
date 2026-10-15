/**
 * Headless physics for "Simulate it for me": the game's own physics runtime (ClayMind's
 * extended IWSDK runtime: compound colliders, contact events) stepped directly at 72 Hz,
 * without drawing. Same bodies as the game (physics/body-build.ts), so a simulated toy
 * behaves like the real one. Deterministic: the same scene and actions give the same run.
 * Runs in a Web Worker in the game (sim-worker.ts) and in Node for tests.
 */
import {
  PHYSICS_HEADER_WORDS, PHYSICS_INPUT_RECORD_FLOATS, PHYSICS_OUTPUT_RECORD_FLOATS, PHYSICS_PROTOCOL_VERSION, physicsExchangeByteLength,
} from '../../node_modules/@iwsdk/core/dist/physics/physics-worker-protocol.js';
import { BODY_DAMPING, buildBody, type BodyPart } from '../physics/body-build.js';
import { encodeCompound, type ContactMessage } from '../physics/runtime/compound-format.js';
import { PhysicsRuntime } from '../physics/runtime/physics-runtime-ext.js';

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export interface SimPiece {
  key: string;
  role?: string;
  parts: BodyPart[];
  p: V3;
  q: Q4;
  /** Static (a board, a ramp, a cup while playing). */
  fixed: boolean;
}

/** The play area's frame: table top at y = 0, the table a rectangle around (cx, cz). */
export interface SimTable {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  /** turn of the table in the play-area frame (rad) */
  yaw: number;
  /** floor below the table top (m) */
  floorY: number;
}

export interface BodyState {
  p: V3;
  q: Q4;
  v: V3;
}

const FLAG_LINEAR_VELOCITY = 32;
const TABLE_DEPTH = 0.25;

export class HeadlessSim {
  readonly dt = 1 / 72;
  time = 0;
  private rt = new PhysicsRuntime();
  private next = 1;
  private dynamic = new Set<number>();
  private states = new Map<number, BodyState>();
  private commands: { handle: number; v: number[] }[] = [];
  private byKey = new Map<string, number>();
  private keyOf = new Map<number, string>();
  private specs = new Map<string, SimPiece>();
  /** Lowest point of each piece in its own frame (to stand it on the table). */
  readonly bottom = new Map<string, number>();
  readonly halfH = new Map<string, number>();
  contacts: [string, string][] = [];

  static async create(table: SimTable): Promise<HeadlessSim> {
    const s = new HeadlessSim();
    s.rt.silence();
    s.rt.onContacts = (c: ContactMessage[]) => {
      for (const m of c) {
        const a = s.keyOf.get(m.a), b = s.keyOf.get(m.b);
        if (a && b) s.contacts.push([a, b]);
      }
    };
    await s.rt.initialize([0, -9.81, 0]);
    s.addTable(table);
    return s;
  }

  private addStaticHull(verts: number[], position: V3, q: Q4): void {
    const handle = this.next++;
    this.rt.addBody({
      type: 'add-body', handle,
      shape: { type: 'ConvexHull', dimensions: [0, 0, 0], density: 1000, friction: 1, restitution: 0, vertices: new Float32Array(verts).buffer },
      state: 'STATIC', position, quaternion: q, linearDamping: 0, angularDamping: 0, gravityFactor: 1, centerOfMass: [Infinity, Infinity, Infinity],
    } as never);
  }

  private addTable(t: SimTable): void {
    // a deep slab under the top (no tunnelling, like the game's table colliders) and a floor
    const box = (hx: number, hy: number, hz: number) => {
      const v: number[] = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) v.push(x, y, z);
      return v;
    };
    const q: Q4 = [0, Math.sin(t.yaw / 2), 0, Math.cos(t.yaw / 2)];
    this.addStaticHull(box(t.halfW, TABLE_DEPTH / 2, t.halfD), [t.cx, -TABLE_DEPTH / 2, t.cz], q);
    this.addStaticHull(box(3, 0.05, 3), [0, t.floorY - 0.05, 0], [0, 0, 0, 1]);
  }

  /** Add (or put back) a piece at a pose; it starts still unless `v` is given. */
  put(piece: SimPiece, p: V3 = piece.p, q: Q4 = piece.q, v?: V3, fixed = piece.fixed): void {
    this.remove(piece.key);
    const built = buildBody(piece.parts, q);
    if (!this.bottom.has(piece.key)) {
      let lo = Infinity, hi = -Infinity;
      for (const pos of built.bodyPositions) for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
      this.bottom.set(piece.key, lo);
      this.halfH.set(piece.key, (hi - lo) / 2);
    }
    const handle = this.next++;
    this.rt.addBody({
      type: 'add-body', handle,
      shape: { type: 'ConvexHull', dimensions: [0, 0, 0], density: 1000, friction: built.friction, restitution: built.restitution, vertices: encodeCompound(built.children).buffer },
      state: fixed ? 'STATIC' : 'DYNAMIC', position: p, quaternion: q,
      linearDamping: BODY_DAMPING.linear, angularDamping: BODY_DAMPING.angular, gravityFactor: 1, centerOfMass: built.props.com,
    } as never);
    if (!fixed) this.dynamic.add(handle);
    this.states.set(handle, { p: [...p] as V3, q: [...q] as Q4, v: v ? [...v] as V3 : [0, 0, 0] });
    this.byKey.set(piece.key, handle);
    this.keyOf.set(handle, piece.key);
    this.specs.set(piece.key, piece);
    if (v && !fixed) this.commands.push({ handle, v });
  }

  remove(key: string): void {
    const h = this.byKey.get(key);
    if (h === undefined) return;
    this.rt.removeBody(h);
    this.dynamic.delete(h);
    this.states.delete(h);
    this.byKey.delete(key);
    this.keyOf.delete(h);
  }

  setVelocity(key: string, v: V3): void {
    const h = this.byKey.get(key);
    if (h !== undefined && this.dynamic.has(h)) this.commands.push({ handle: h, v });
  }

  get(key: string): BodyState | undefined {
    const h = this.byKey.get(key);
    return h === undefined ? undefined : this.states.get(h);
  }

  piece(key: string): SimPiece | undefined {
    return this.specs.get(key);
  }

  keys(): string[] {
    return [...this.byKey.keys()];
  }

  step(): void {
    const cmds = this.commands.splice(0);
    const buf = new ArrayBuffer(physicsExchangeByteLength(cmds.length, this.dynamic.size));
    const ints = new Int32Array(buf), f = new Float32Array(buf);
    ints[0] = PHYSICS_PROTOCOL_VERSION;
    ints[2] = cmds.length;
    ints[5] = 1;
    f[8] = this.dt;
    cmds.forEach((c, i) => {
      const base = PHYSICS_HEADER_WORDS + i * PHYSICS_INPUT_RECORD_FLOATS;
      f[base] = c.handle;
      f[base + 1] = FLAG_LINEAR_VELOCITY;
      f.set(c.v, base + 15);
    });
    const res = this.rt.step(buf);
    if (res.error) throw new Error(res.error);
    const out = new Float32Array(res.buffer), outInts = new Int32Array(res.buffer);
    for (let i = 0; i < outInts[3]; i++) {
      const base = PHYSICS_HEADER_WORDS + i * PHYSICS_OUTPUT_RECORD_FLOATS;
      const s = this.states.get(out[base]);
      if (!s) continue;
      s.p = [out[base + 1], out[base + 2], out[base + 3]];
      s.q = [out[base + 4], out[base + 5], out[base + 6], out[base + 7]];
      s.v = [out[base + 8], out[base + 9], out[base + 10]];
    }
    this.time += this.dt;
  }

  destroy(): void {
    this.rt.destroy();
  }
}

export function speed(v: V3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Tilt of a body's up axis from world up, degrees. */
export function tiltDeg(q: Q4): number {
  const [x, , z] = q;
  const uy = 1 - 2 * (x * x + z * z);
  return (Math.acos(Math.max(-1, Math.min(1, uy))) * 180) / Math.PI;
}
