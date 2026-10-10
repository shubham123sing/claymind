/**
 * Headless physics for tests: IWSDK 1.0.1's own PhysicsRuntime (the code that
 * runs inside the game's physics worker) driven directly, at 72 Hz.
 * Lets physics behaviour be unit-tested without a browser.
 */
// not in the package exports: import the file the worker uses
import { PhysicsRuntime } from '../../node_modules/@iwsdk/core/dist/physics/physics-runtime.js';
import {
  PHYSICS_HEADER_WORDS, PHYSICS_INPUT_RECORD_FLOATS, PHYSICS_OUTPUT_RECORD_FLOATS, PHYSICS_PROTOCOL_VERSION, physicsExchangeByteLength,
} from '../../node_modules/@iwsdk/core/dist/physics/physics-worker-protocol.js';

export type Shape =
  | { type: 'Box'; size: [number, number, number] }
  | { type: 'Sphere'; r: number }
  | { type: 'ConvexHull'; vertices: Float32Array };

export interface BodySpec {
  shape: Shape;
  state?: 'STATIC' | 'DYNAMIC' | 'KINEMATIC';
  position: [number, number, number];
  quaternion?: [number, number, number, number];
  density?: number;
  friction?: number;
  restitution?: number;
  gravityFactor?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Local centre of mass; omitted = computed by Havok from the shape. */
  centerOfMass?: [number, number, number];
}

export interface BodyState {
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  w: [number, number, number];
}

const FLAG_LINEAR_VELOCITY = 32;
const FLAG_ANGULAR_VELOCITY = 64;
const FLAG_GRAVITY = 128;

export class HavokSim {
  readonly dt = 1 / 72;
  private rt = new PhysicsRuntime();
  private next = 1;
  private dynamic = new Set<number>();
  private states = new Map<number, BodyState>();
  private commands: { handle: number; flags: number; v?: number[]; w?: number[]; g?: number }[] = [];
  time = 0;

  static async create(): Promise<HavokSim> {
    // Havok fetches its .wasm next to the module; Node's fetch has no file: support
    const realFetch = globalThis.fetch;
    if (!(realFetch as { havokPatched?: boolean }).havokPatched) {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const patched = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('file:')) return new Response(await readFile(fileURLToPath(url)), { headers: { 'Content-Type': 'application/wasm' } });
        return realFetch(input, init);
      }) as typeof fetch & { havokPatched?: boolean };
      patched.havokPatched = true;
      globalThis.fetch = patched;
    }
    const s = new HavokSim();
    await s.rt.initialize([0, -9.81, 0]);
    return s;
  }

  add(b: BodySpec): number {
    const handle = this.next++;
    const sh = b.shape;
    const state = b.state ?? 'DYNAMIC';
    const com = this.rt.addBody({
      type: 'add-body',
      handle,
      shape: {
        type: sh.type,
        dimensions: sh.type === 'Box' ? sh.size : sh.type === 'Sphere' ? [sh.r, 0, 0] : [0, 0, 0],
        density: b.density ?? 1000,
        friction: b.friction ?? 0.5,
        restitution: b.restitution ?? 0.1,
        vertices: sh.type === 'ConvexHull' ? sh.vertices.slice().buffer : undefined,
      },
      state,
      position: b.position,
      quaternion: b.quaternion ?? [0, 0, 0, 1],
      linearDamping: b.linearDamping ?? 0,
      angularDamping: b.angularDamping ?? 0.05,
      gravityFactor: b.gravityFactor ?? 1,
      centerOfMass: b.centerOfMass ?? [Infinity, Infinity, Infinity],
    });
    void com;
    if (state !== 'STATIC') this.dynamic.add(handle);
    this.states.set(handle, { p: [...b.position], q: b.quaternion ?? [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0] });
    return handle;
  }

  setVelocity(handle: number, v: [number, number, number]): void {
    this.commands.push({ handle, flags: FLAG_LINEAR_VELOCITY, v });
  }

  setAngularVelocity(handle: number, w: [number, number, number]): void {
    this.commands.push({ handle, flags: FLAG_ANGULAR_VELOCITY, w });
  }

  setGravityFactor(handle: number, g: number): void {
    this.commands.push({ handle, flags: FLAG_GRAVITY, g });
  }

  get(handle: number): BodyState {
    return this.states.get(handle)!;
  }

  /** Advance one 72 Hz step; `each` runs after every step. */
  step(n = 1, each?: () => void): void {
    for (let k = 0; k < n; k++) {
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
        f[base + 1] = c.flags;
        if (c.v) f.set(c.v, base + 15);
        if (c.w) f.set(c.w, base + 18);
        if (c.g !== undefined) f[base + 21] = c.g;
      });
      const res = this.rt.step(buf);
      if (res.error) throw new Error(res.error);
      const out = new Float32Array(res.buffer), outInts = new Int32Array(res.buffer);
      for (let i = 0; i < outInts[3]; i++) {
        const base = PHYSICS_HEADER_WORDS + i * PHYSICS_OUTPUT_RECORD_FLOATS;
        const s = this.states.get(out[base])!;
        s.p = [out[base + 1], out[base + 2], out[base + 3]];
        s.q = [out[base + 4], out[base + 5], out[base + 6], out[base + 7]];
        s.v = [out[base + 8], out[base + 9], out[base + 10]];
        s.w = [out[base + 11], out[base + 12], out[base + 13]];
      }
      this.time += this.dt;
      each?.();
    }
  }

  seconds(s: number, each?: () => void): void {
    this.step(Math.round(s / this.dt), each);
  }

  destroy(): void {
    this.rt.destroy();
  }
}

/** Tilt of a body's local up axis from world up, in degrees, and its x lean sign. */
export function tiltOf(q: [number, number, number, number]): { deg: number; leanX: number } {
  const [x, y, z, w] = q;
  // rotate (0,1,0)
  const ux = 2 * (x * y - w * z), uy = 1 - 2 * (x * x + z * z);
  void z;
  return { deg: (Math.acos(Math.max(-1, Math.min(1, uy))) * 180) / Math.PI, leanX: Math.abs(ux) < 0.02 ? 0 : Math.sign(ux) };
}
