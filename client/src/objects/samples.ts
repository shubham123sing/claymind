/**
 * Ready-made sample creations for the Library on the first run (plan v4,
 * Phase 9): a hammer (wood handle + stone head), a painted cup and a striped
 * rubber ball. Built from SDFs with the same bake as sculpts. Main thread, once.
 */
import type { SavedPart } from '../storage/library.js';
import { bakeFromSdf, PaintFn } from './bake.js';
import { Creation, CREATION_SCHEMA_VERSION } from './creation.js';
import type { ShapeDescriptor } from './descriptor.js';

type Sdf = (x: number, y: number, z: number) => number;

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Sdf => (x, y, z) => {
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
};
const rgba = (out: Uint8Array, o: number, hex: number) => {
  out[o] = (hex >> 16) & 255; out[o + 1] = (hex >> 8) & 255; out[o + 2] = hex & 255; out[o + 3] = 255;
};

function part(label: number, materialId: string, sdf: Sdf, extent: number, color: string | null = null, paint?: PaintFn): SavedPart {
  const b = bakeFromSdf(sdf, extent, { res: 44, pieces: 5, paint });
  const p = b.parts[0];
  return { label, materialId, color, mesh: p.mesh, shards: p.shards, collider: p.collider, frame: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
}

function creation(id: string, name: string, parts: SavedPart[], sizeCm: [number, number, number]): Creation {
  const descriptor: ShapeDescriptor = {
    aspect: 1, elong: 1, fill: 0.5, openTop: 0, holes: 0, profile: [1, 1, 1, 1, 1], angle: 0, center: [0, 0, 0],
    extents: sizeCm.map((v) => v / 100) as [number, number, number], volume: 0,
  };
  return {
    schemaVersion: CREATION_SCHEMA_VERSION, id, createdAt: Date.now(), descriptor, name, category: 'sample', source: 'sculpt-only',
    templateId: null, matchScore: 0, bestGuess: null, materialId: parts[0].materialId, materialConfidence: 1, materialGuesses: [],
    parts: parts.map((p) => ({ label: p.label, materialId: p.materialId, materialConfidence: 1, by: 'user' as const, color: p.color, massKg: 0, volumeCm3: 0 })),
    massKg: 0, sizeCm, volumeCm3: 0, timeToObject: 0, kgNodeIds: [],
  };
}

export function buildSamples(): { creation: Creation; parts: SavedPart[] }[] {
  // hammer: 22 cm wooden handle, stone head across its end
  const handle = part(0, 'wood', box(-0.02, 0, 0, 0.1, 0.01, 0.01), 0.24);
  const head = part(1, 'stone', box(0.095, 0, 0, 0.018, 0.018, 0.045), 0.24);
  // cup: white stone with a painted blue band and a yellow rim line
  const cupSdf: Sdf = (x, y, z) => {
    const r = Math.hypot(x, z);
    const outer = Math.max(r - 0.04, Math.abs(y) - 0.045);
    const inner = Math.max(r - 0.033, -(y + 0.039));
    return Math.max(outer, -inner);
  };
  const cupPaint: PaintFn = (x, y, z, out, o) => {
    const r = Math.hypot(x, z);
    if (r > 0.036 && y > -0.012 && y < 0.008) rgba(out, o, 0x3355dd);
    else if (y > 0.04) rgba(out, o, 0xf0b429);
    else out[o + 3] = 0;
  };
  const cup = part(0, 'stone', cupSdf, 0.1, '#f4f1ec', cupPaint);
  // ball: orange rubber with yellow stripes
  const ballPaint: PaintFn = (x, y, z, out, o) => {
    if (Math.sin(Math.atan2(z, x) * 4) > 0.55) rgba(out, o, 0xf6c855);
    else out[o + 3] = 0;
  };
  const ball = part(0, 'rubber', (x, y, z) => Math.hypot(x, y, z) - 0.035, 0.07, null, ballPaint);
  return [
    { creation: creation('sample_hammer', 'Hammer', [handle, head], [24, 4, 9]), parts: [handle, head] },
    { creation: creation('sample_cup', 'Painted cup', [cup], [8, 9, 8]), parts: [cup] },
    { creation: creation('sample_ball', 'Striped ball', [ball], [7, 7, 7]), parts: [ball] },
  ];
}
