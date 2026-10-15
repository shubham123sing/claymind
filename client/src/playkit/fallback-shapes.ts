/**
 * Built-in Play Kit shapes for game roles the player's kit does not fill. Each
 * is one or more simple convex parts (boxes, cylinders, spheres), so every part
 * gets an exact convex collider: a board is a floor plus four rim walls, a cup
 * a bottom plus wall segments, a ramp a tilted plank plus two rails.
 * Sizes match FALLBACK_SIZE in kit-store.ts.
 */
// plain three.js maths (no renderer): the headless simulator builds these shapes in a worker
import { BoxGeometry, BufferGeometry, CylinderGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { SavedPart } from '../storage/library.js';
import type { FallbackShape } from './game-spec.js';

type Frame = SavedPart['frame'];
const ID: Frame = { p: [0, 0, 0], q: [0, 0, 0, 1] };

function mesh(g: BufferGeometry): SavedPart['mesh'] {
  const n = g.index ? g.toNonIndexed() : g;
  const out = { positions: new Float32Array(n.getAttribute('position').array), normals: new Float32Array(n.getAttribute('normal').array) };
  g.dispose();
  if (n !== g) n.dispose();
  return out;
}

const part = (label: number, g: BufferGeometry, materialId: string, color: string | null, frame: Frame = ID): SavedPart => ({
  label, materialId, color, mesh: mesh(g), shards: [], frame,
});

const cache = new Map<string, SavedPart[]>();

/** Parts of a built-in shape (shared and read-only: callers must not change them). `tiltDeg`: ramp angle (What-if). */
export function fallbackParts(shape: FallbackShape, materialId: string, color: string | null = null, tiltDeg = RAMP_TILT_DEG): SavedPart[] {
  const key = `${shape}|${materialId}|${color}|${tiltDeg}`;
  let parts = cache.get(key);
  if (!parts) {
    parts = build(shape, materialId, color, tiltDeg);
    cache.set(key, parts);
  }
  return parts;
}

export const RAMP_TILT_DEG = 16;

function build(shape: FallbackShape, m: string, c: string | null, tiltDeg: number): SavedPart[] {
  switch (shape) {
    case 'block':
      return [part(0, new BoxGeometry(0.04, 0.04, 0.04), m, c)];
    case 'ball':
      return [part(0, new SphereGeometry(0.018, 24, 16), m, c)];
    case 'marble':
      return [part(0, new SphereGeometry(0.01, 20, 14), m, c)];
    case 'disc':
      return [part(0, new CylinderGeometry(0.018, 0.018, 0.008, 28), m, c)];
    case 'coin':
      return [part(0, new CylinderGeometry(0.014, 0.014, 0.006, 24), m, c)];
    case 'board': {
      // 36 cm square, 1 cm floor, rim 1.2 cm wide and 1.1 cm above the floor
      const half = 0.18, rim = 0.012, h = 0.021;
      return [
        part(0, new BoxGeometry(half * 2, 0.01, half * 2), m, c),
        part(1, new BoxGeometry(half * 2, h, rim), m, c ?? '#8a5a2b', { p: [0, h / 2 - 0.005, -half + rim / 2], q: [0, 0, 0, 1] }),
        part(2, new BoxGeometry(half * 2, h, rim), m, c ?? '#8a5a2b', { p: [0, h / 2 - 0.005, half - rim / 2], q: [0, 0, 0, 1] }),
        part(3, new BoxGeometry(rim, h, half * 2 - rim * 2), m, c ?? '#8a5a2b', { p: [-half + rim / 2, h / 2 - 0.005, 0], q: [0, 0, 0, 1] }),
        part(4, new BoxGeometry(rim, h, half * 2 - rim * 2), m, c ?? '#8a5a2b', { p: [half - rim / 2, h / 2 - 0.005, 0], q: [0, 0, 0, 1] }),
      ];
    }
    case 'cup': {
      // 7 cm across, 6 cm tall, 12 wall segments around a 5 mm bottom
      const r = 0.035, h = 0.06, wall = 0.005, n = 12;
      const parts = [part(0, new CylinderGeometry(r, r, 0.005, 24), m, c, { p: [0, -h / 2 + 0.0025, 0], q: [0, 0, 0, 1] })];
      const seg = 2 * Math.PI * (r - wall / 2) / n + 0.002;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a);
        parts.push(part(i + 1, new BoxGeometry(seg, h, wall), m, c, { p: [Math.sin(a) * (r - wall / 2), 0, Math.cos(a) * (r - wall / 2)], q: q.toArray() as Frame['q'] }));
      }
      return parts;
    }
    case 'ramp': {
      // a 32 cm plank (8 cm wide, 1.4 cm thick) tilted 16° down toward the player, with 1 cm rails
      const len = 0.32, w = 0.08, t = 0.014, rail = 0.012, tilt = (tiltDeg * Math.PI) / 180;
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt).toArray() as Frame['q'];
      const lift = Math.sin(tilt) * (len / 2);
      const up = (dy: number, dx: number): Frame['p'] => [dx, lift + dy * Math.cos(tilt), dy * Math.sin(tilt)];
      return [
        part(0, new BoxGeometry(w, t, len), m, c, { p: up(0, 0), q }),
        part(1, new BoxGeometry(0.008, t + rail, len), m, c ?? '#8a5a2b', { p: up(rail / 2, -w / 2 - 0.004), q }),
        part(2, new BoxGeometry(0.008, t + rail, len), m, c ?? '#8a5a2b', { p: up(rail / 2, w / 2 + 0.004), q }),
      ];
    }
  }
}

/** Lowest point of a shape in its own frame (to stand it on the table). */
export function bottomOf(parts: { mesh: { positions: Float32Array }; frame: { p: number[]; q: number[] } }[]): number {
  let min = Infinity;
  const v = new Vector3(), q = new Quaternion();
  for (const p of parts) {
    q.fromArray(p.frame.q);
    const pos = p.mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyQuaternion(q);
      min = Math.min(min, v.y + p.frame.p[1]);
    }
  }
  return min;
}
