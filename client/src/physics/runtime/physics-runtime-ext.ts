/**
 * ClayMind's physics runtime: IWSDK 1.0.1's PhysicsRuntime (runs inside IWSDK's
 * physics worker), extended with Havok features IWSDK does not expose yet:
 *   - compound colliders: a ConvexHull whose vertex buffer carries a compound
 *     description (compound-format.ts) becomes a Havok container with one child
 *     per piece, each with its own density / friction / restitution
 *   - collision events: every new contact of a dynamic body is posted with its
 *     impulse on a BroadcastChannel (CONTACT_CHANNEL)
 * Swapped in by the `claymindPhysicsRuntime` Vite plugin (vite.config.ts) for
 * the worker's own `./physics-runtime.js` import; IWSDK's main-thread
 * PhysicsSystem is unchanged. Plain hulls, boxes, spheres... go to IWSDK's code.
 */
import { PhysicsRuntime as IwsdkPhysicsRuntime } from '../../../node_modules/@iwsdk/core/dist/physics/physics-runtime.js';
import type { PhysicsWorkerAddBodyMessage } from '../../../node_modules/@iwsdk/core/dist/physics/physics-worker-protocol.js';
import { CompoundChild, CONTACT_CHANNEL, ContactMessage, decodeCompound, isCompound } from './compound-format.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Havok = any;

interface BodyEntry {
  body: any;
  shape: any;
  state: string;
  transformOffset: number;
  /** compound only: child shapes to release with the container */
  children?: any[];
}

interface RuntimeState {
  havok?: Havok;
  havokWorld?: any;
  bodies: Map<number, BodyEntry>;
}

/** Exchange buffer header word indices (IWSDK physics-worker-protocol PhysicsHeaderIndex, a const enum). */
const HEADER = { Version: 0, Sequence: 1, CommandCount: 2, ResultCount: 3, Status: 4, StepCount: 5, Delta: 8 } as const;

/** Ignore contacts softer than this (resting jitter), N·s. */
const MIN_IMPULSE = 0.004;

export class PhysicsRuntime extends IwsdkPhysicsRuntime {
  /** Havok body id -> IWSDK handle, for collision events. */
  private handleOf = new Map<string, number>();
  private channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CONTACT_CHANNEL);
  /** Tests: receive contacts directly instead of (or as well as) the channel. */
  onContacts: ((c: ContactMessage[]) => void) | null = null;

  /** Headless simulations: keep their contacts to themselves (never on the game's channel). */
  silence(): void {
    this.channel?.close();
    this.channel = null;
  }
  private reported = false;
  private stats = { steps: 0, raw: 0, posted: 0, masked: 0 };

  constructor() {
    super();
    // debug: `new BroadcastChannel(CONTACT_CHANNEL).postMessage('ping')` -> stats
    if (this.channel) this.channel.onmessage = (e) => e.data === 'ping' && this.channel!.postMessage({ pong: true, bodies: this.st.bodies.size, ...this.stats });
  }

  private get st(): RuntimeState {
    return (this as unknown as { state: RuntimeState }).state;
  }

  addBody(message: PhysicsWorkerAddBodyMessage): [number, number, number] {
    const v = message.shape.type === 'ConvexHull' && message.shape.vertices ? new Float32Array(message.shape.vertices) : null;
    const com = v && isCompound(v) ? this.addCompound(message, decodeCompound(v)) : super.addBody(message);
    const entry = this.st.bodies.get(message.handle);
    if (entry) {
      const H = this.st.havok;
      this.handleOf.set(idKey(entry.body), message.handle);
      if (message.state !== 'STATIC') {
        H.HP_Body_SetEventMask(entry.body, eventBit(H));
        this.stats.masked++;
      }
    }
    return com;
  }

  removeBody(handle: number): void {
    const entry = this.st.bodies.get(handle);
    if (entry) this.handleOf.delete(idKey(entry.body));
    const children = entry?.children;
    super.removeBody(handle);
    if (children) for (const c of children) this.st.havok.HP_Shape_Release(c);
  }

  step(buffer: ArrayBuffer): ReturnType<IwsdkPhysicsRuntime['step']> {
    // IWSDK may ask for several fixed sub-steps in one call (catching up after a
    // slow frame); Havok only keeps the collision events of the last one. Run
    // them one at a time so no hit is missed.
    const ints = new Int32Array(buffer), floats = new Float32Array(buffer);
    const n = Math.max(0, ints[HEADER.StepCount]);
    if (n <= 1) {
      const r = super.step(buffer);
      this.stats.steps += n;
      if (!r.error) this.collectContacts();
      return r;
    }
    ints[HEADER.StepCount] = 1;
    const first = super.step(buffer); // applies the commands once
    ints[HEADER.StepCount] = n;
    this.stats.steps++;
    if (first.error) return first;
    this.collectContacts();
    if (this.scratch?.byteLength !== buffer.byteLength) this.scratch = new ArrayBuffer(buffer.byteLength);
    const s = this.scratch, si = new Int32Array(s), sf = new Float32Array(s);
    for (let k = 1; k < n; k++) {
      si.fill(0);
      si[HEADER.Version] = ints[HEADER.Version];
      si[HEADER.StepCount] = 1;
      sf[HEADER.Delta] = floats[HEADER.Delta];
      const r = super.step(s); // no commands: just one more step, results written to the scratch buffer
      this.stats.steps++;
      if (r.error) return r;
      this.collectContacts();
    }
    // the last sub-step's results go back to IWSDK in its own buffer
    const sequence = ints[HEADER.Sequence], commands = ints[HEADER.CommandCount];
    new Uint8Array(buffer).set(new Uint8Array(s));
    ints[HEADER.Sequence] = sequence;
    ints[HEADER.CommandCount] = commands;
    ints[HEADER.StepCount] = n;
    return { buffer };
  }
  private scratch: ArrayBuffer | null = null;

  /** Same steps as IWSDK's addBody, with a Havok container as the shape. */
  private addCompound(message: PhysicsWorkerAddBodyMessage, children: CompoundChild[]): [number, number, number] {
    const H = this.st.havok, world = this.st.havokWorld;
    this.removeBody(message.handle);
    const container = H.HP_Shape_CreateContainer()[1];
    const made: any[] = [];
    for (const c of children) {
      const at = [c.frame?.p ?? [0, 0, 0], c.frame?.q ?? [0, 0, 0, 1], [1, 1, 1]];
      const add = (shape: any) => {
        H.HP_Shape_SetDensity(shape, c.density);
        H.HP_Shape_SetMaterial(shape, [c.friction, c.friction, c.restitution, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM]);
        H.HP_Shape_AddChild(container, shape, at);
        made.push(shape);
      };
      if (c.kind === 'hull') {
        const ptr = H._malloc(c.data.byteLength);
        try {
          new Float32Array(H.HEAPU8.buffer, ptr, c.data.length).set(c.data); // as IWSDK's copyFloat32ToHeap
          add(H.HP_Shape_CreateConvexHull(ptr, c.data.length / 3)[1]);
        } finally {
          H._free(ptr);
        }
      } else {
        for (let i = 0; i < c.data.length; i += 6) {
          const d = c.data;
          add(H.HP_Shape_CreateBox([d[i], d[i + 1], d[i + 2]], [0, 0, 0, 1], [d[i + 3], d[i + 4], d[i + 5]])[1]);
        }
      }
    }
    let body: any;
    let added = false;
    try {
      body = H.HP_Body_Create()[1];
      H.HP_Body_SetShape(body, container);
      H.HP_Body_SetQTransform(body, [message.position, message.quaternion]);
      H.HP_Body_SetLinearDamping(body, message.linearDamping);
      H.HP_Body_SetAngularDamping(body, message.angularDamping);
      H.HP_Body_SetGravityFactor(body, message.gravityFactor);
      const built = H.HP_Shape_BuildMassProperties(container);
      const mp = built[0] === H.Result.RESULT_OK ? built[1] : [[0, 0, 0], 1, [1, 1, 1], [0, 0, 0, 1]];
      if (message.centerOfMass.every((x) => x === Infinity)) message.centerOfMass = [...mp[0]] as [number, number, number];
      else mp[0] = [...message.centerOfMass];
      H.HP_Body_SetMassProperties(body, mp);
      H.HP_Body_SetMotionType(body, message.state === 'STATIC' ? H.MotionType.STATIC : message.state === 'KINEMATIC' ? H.MotionType.KINEMATIC : H.MotionType.DYNAMIC);
      H.HP_World_AddBody(world, body, false);
      added = true;
      this.st.bodies.set(message.handle, {
        body, shape: container, state: message.state, transformOffset: H.HP_Body_GetWorldTransformOffset(body)[1], children: made,
      });
    } catch (e) {
      if (body) {
        if (added) H.HP_World_RemoveBody(world, body);
        H.HP_Body_Release(body);
      }
      H.HP_Shape_Release(container);
      for (const c of made) H.HP_Shape_Release(c);
      throw e;
    }
    return message.centerOfMass;
  }

  private collectContacts(): void {
    const H = this.st.havok, world = this.st.havokWorld;
    if (!H) return;
    const out: ContactMessage[] = [];
    const started = eventBit(H);
    for (let e = H.HP_World_GetCollisionEvents(world)[1]; e; e = H.HP_World_GetNextCollisionEvent(world, e)) {
      const ev = H.HP_Event_AsCollision(e)[1];
      this.stats.raw++;
      if (enumValue(ev[0]) !== started || ev[3] < MIN_IMPULSE) continue;
      const a = this.handleOf.get(idKey(ev[1][0])), b = this.handleOf.get(idKey(ev[2][0]));
      if (a === undefined || b === undefined) continue;
      out.push({ a, b, impulse: ev[3], p: [...ev[1][3]] as [number, number, number], n: [...ev[1][4]] as [number, number, number] });
    }
    if (!out.length) return;
    if (!this.reported) {
      this.reported = true;
      console.info(`[physics] collision events on (${out.length} in the first batch)`);
    }
    this.onContacts?.(out);
    this.stats.posted += out.length;
    this.channel?.postMessage(out);
  }
}

const idKey = (id: any): string => String(Array.isArray(id) ? id[0] : id);
const enumValue = (e: any): number => (typeof e === 'object' && e !== null && 'value' in e ? e.value : e);
const eventBit = (H: Havok): number => enumValue(H.EventType.COLLISION_STARTED);
