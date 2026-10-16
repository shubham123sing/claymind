/**
 * Which part of the brain to show (progressive disclosure, ~20-40 nodes):
 * - focused creation: the creation, what it is / is made of / its features,
 *   every edge on its reasoning paths, the material's and concept's other
 *   properties (so wrong ones can be cut), and the predicted behaviours;
 * - no focus: an overview of materials -> properties -> behaviours.
 * Recently cut (rejected) edges stay visible, faded, so they can be undone.
 */
import type { Brain, Prediction } from '../kg/brain.js';
import type { KGEdge, KGNode } from '../kg/schema.js';

export interface FocusGraph {
  focus: string | null;
  nodes: KGNode[];
  edges: KGEdge[];
  predictions: Prediction[];
}

const MAX_NODES = 40;

export function focusGraph(brain: Brain, focus: string | null): FocusGraph {
  const g = brain.graph;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let predictions: Prediction[] = [];

  const addEdge = (e: KGEdge | undefined) => {
    if (!e) return;
    edgeIds.add(e.id);
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  };

  if (focus && g.node(focus)) {
    nodeIds.add(focus);
    predictions = brain.predictions(focus).filter((p) => p.confidence >= 0.05);
    for (const p of predictions) {
      nodeIds.add(p.behaviorId);
      for (const id of p.path) addEdge(g.edge(id));
    }
    // direct facts about the creation (incl. rejected ones, shown faded)
    const direct = g.outgoing(focus);
    for (const e of direct) addEdge(e);
    // properties of its materials / concepts (editable beliefs even if unused)
    for (const e of direct) {
      if (e.status === 'rejected') continue;
      if (e.relation === 'made_of' || e.relation === 'is_a') for (const k of g.outgoing(e.to)) if (k.relation !== 'is_a') addEdge(k);
    }
    // where each shown property leads
    for (const id of [...nodeIds]) {
      const n = g.node(id);
      if (n?.type === 'Property' || n?.type === 'ShapeFeature') for (const k of g.outgoing(id)) if (k.relation === 'causes' || k.relation === 'implies' || k.relation === 'contradicts') addEdge(k);
    }
  } else {
    focus = null;
    for (const e of g.edges.values()) {
      const from = g.node(e.from);
      if (from && (from.type === 'Material' || from.type === 'Property')) addEdge(e);
    }
  }

  let nodes = [...nodeIds].map((id) => g.node(id)).filter((n): n is KGNode => !!n);
  if (nodes.length > MAX_NODES) {
    // keep the focus, path nodes and predicted behaviours first
    const keep = new Set<string>([focus ?? '', ...predictions.flatMap((p) => [p.behaviorId, ...p.path.flatMap((id) => id.split('|').filter((_, i) => i !== 1))])]);
    nodes = [...nodes.filter((n) => keep.has(n.id)), ...nodes.filter((n) => !keep.has(n.id))].slice(0, MAX_NODES);
  }
  const shown = new Set(nodes.map((n) => n.id));
  const edges = [...edgeIds].map((id) => g.edge(id)!).filter((e) => e && shown.has(e.from) && shown.has(e.to));
  return { focus, nodes, edges, predictions };
}
