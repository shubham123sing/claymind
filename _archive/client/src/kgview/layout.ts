/**
 * Deterministic layered layout for the brain view, read left -> right like a
 * chain of reasoning: Creation | Concept, Material, ShapeFeature | Property | Behavior.
 * Nodes in a column are ordered by the barycentre of their neighbours (fewer
 * crossings), then spread evenly. The panel bends toward the viewer. Positions
 * are computed once per graph change, so nothing jitters.
 */
import type { KGEdge, KGNode, NodeType } from '../kg/schema.js';

const COLUMN: Record<NodeType, number> = {
  Creation: 0, Challenge: 0, Context: 0,
  Concept: 1, Material: 1, ShapeFeature: 1,
  Property: 2,
  Behavior: 3,
};

export interface LayoutOptions {
  width: number;
  height: number;
  /** How much the panel curves toward the viewer at its edges (m). */
  bend: number;
}

export function layoutGraph(nodes: KGNode[], edges: KGEdge[], o: LayoutOptions = { width: 0.56, height: 0.3, bend: 0.06 }): Map<string, [number, number, number]> {
  const cols: KGNode[][] = [[], [], [], []];
  for (const n of nodes) cols[COLUMN[n.type] ?? 0].push(n);
  // drop empty columns so the graph uses the full width
  const used = cols.filter((c) => c.length > 0);
  // stable initial order: type then label
  for (const c of used) c.sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type)));
  const index = new Map<string, number>();
  const reindex = () => used.forEach((c) => c.forEach((n, i) => index.set(n.id, i / Math.max(1, c.length - 1))));
  reindex();
  const nb = new Map<string, string[]>();
  for (const e of edges) {
    (nb.get(e.from) ?? nb.set(e.from, []).get(e.from)!).push(e.to);
    (nb.get(e.to) ?? nb.set(e.to, []).get(e.to)!).push(e.from);
  }
  // two barycentre sweeps (left->right, right->left)
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 === 0 ? used : [...used].reverse();
    for (const c of order) {
      const bary = (n: KGNode) => {
        const ns = (nb.get(n.id) ?? []).filter((id) => index.has(id));
        return ns.length ? ns.reduce((a, id) => a + index.get(id)!, 0) / ns.length : index.get(n.id)!;
      };
      const keyed = c.map((n) => [bary(n), n] as const);
      keyed.sort((a, b) => a[0] - b[0]);
      c.splice(0, c.length, ...keyed.map((k) => k[1]));
      reindex();
    }
  }
  const out = new Map<string, [number, number, number]>();
  used.forEach((c, ci) => {
    const x = used.length === 1 ? 0 : -o.width / 2 + (ci / (used.length - 1)) * o.width;
    const z = -o.bend * (1 - Math.pow((2 * x) / o.width, 2));
    c.forEach((n, i) => {
      const y = c.length === 1 ? 0 : o.height / 2 - (i / (c.length - 1)) * o.height;
      out.set(n.id, [x, y, z]);
    });
  });
  return out;
}
