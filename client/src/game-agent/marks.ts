/** Point + Say marks (pure, no engine): item keys, a drawn loop -> a zone, a route -> a path. */

export interface Mark {
  id: string;
  kind: 'zone' | 'path';
  /** play-area frame */
  points: [number, number, number][];
  center: [number, number, number];
  radius: number;
}

export function itemKey(i: { toyId?: string; creationId?: string } | null): string | null {
  return i ? (i.toyId ? `toy:${i.toyId}` : i.creationId ? `c:${i.creationId}` : null) : null;
}

/** A loop drawn on the table -> a circle (centre, mean radius); null if it is not a loop. */
export function fitZone(pts: [number, number, number][]): { center: [number, number, number]; radius: number } | null {
  if (pts.length < 6) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  const a = pts[0], b = pts[pts.length - 1];
  if (len < 0.12 || Math.hypot(a[0] - b[0], a[2] - b[2]) > Math.max(0.05, len * 0.25)) return null;
  const c: [number, number, number] = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const radius = pts.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[2] - c[2]), 0) / pts.length;
  return { center: [c[0], 0, c[2]], radius: Math.max(0.03, Math.min(0.25, radius)) };
}

/** A route: at most 12 points, evenly along it. */
export function simplifyPath(pts: [number, number, number][]): [number, number, number][] {
  if (pts.length <= 12) return pts;
  const out: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) out.push(pts[Math.round((i * (pts.length - 1)) / 11)]);
  return out;
}
