/**
 * In-memory Knowledge Graph store with an undoable change log.
 * Pure TypeScript (no Three/DOM): unit-tested and persisted via storage/kg-repo.
 */
import { KG_SCHEMA_VERSION, KGChange, KGEdge, KGNode, KGSnapshot, NodeType, Relation, EdgeSource } from './schema.js';

export type GraphListener = () => void;

const MAX_LOG = 300;

export function edgeId(from: string, relation: Relation, to: string): string {
  return `${from}|${relation}|${to}`;
}

export class KnowledgeGraph {
  readonly nodes = new Map<string, KGNode>();
  readonly edges = new Map<string, KGEdge>();
  log: KGChange[] = [];
  private group = 0;
  private listeners = new Set<GraphListener>();
  /** Bumps on every change (views and the reasoner cache on it). */
  version = 0;

  onChange(fn: GraphListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Group several edits into one undo step. */
  batch(by: KGChange['by'], fn: () => void): void {
    if (this.inBatch) {
      fn();
      return;
    }
    this.group++;
    const prev = this.currentBy;
    this.currentBy = by;
    this.inBatch = true;
    try {
      fn();
    } finally {
      this.inBatch = false;
      this.currentBy = prev;
    }
    this.changed();
  }
  private currentBy: KGChange['by'] = 'system';
  private inBatch = false;

  /** Mutations outside batch() become their own (system) undo group. */
  private mutate<T>(fn: () => T): T {
    if (this.inBatch) return fn();
    let r!: T;
    this.batch('system', () => {
      r = fn();
    });
    return r;
  }

  private record(c: Omit<KGChange, 'at' | 'group' | 'by'>): void {
    this.log.push({ ...c, at: Date.now(), group: this.group, by: this.currentBy });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  node(id: string): KGNode | undefined {
    return this.nodes.get(id);
  }

  ensureNode(id: string, type: NodeType, label: string, props: Record<string, unknown> = {}): KGNode {
    const existing = this.nodes.get(id);
    if (existing) return existing;
    return this.mutate(() => {
      const n: KGNode = { id, type, label, props, createdAt: Date.now() };
      this.nodes.set(id, n);
      this.record({ kind: 'add-node', before: null, after: { ...n } });
      return n;
    });
  }

  removeNode(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    this.mutate(() => {
      for (const e of [...this.edges.values()]) if (e.from === id || e.to === id) this.removeEdgeRaw(e);
      this.nodes.delete(id);
      this.record({ kind: 'remove-node', before: { ...n }, after: null });
    });
  }

  private removeEdgeRaw(e: KGEdge): void {
    this.edges.delete(e.id);
    this.record({ kind: 'update-edge', before: { ...e }, after: null });
  }

  /** Create or update an edge (keyed by from|relation|to). */
  setEdge(
    from: string, relation: Relation, to: string,
    fields: Partial<Pick<KGEdge, 'confidence' | 'source' | 'status' | 'evidence'>> & { confidence: number; source: EdgeSource },
  ): KGEdge {
    return this.mutate(() => this.setEdgeRaw(from, relation, to, fields));
  }

  private setEdgeRaw(
    from: string, relation: Relation, to: string,
    fields: Partial<Pick<KGEdge, 'confidence' | 'source' | 'status' | 'evidence'>> & { confidence: number; source: EdgeSource },
  ): KGEdge {
    const id = edgeId(from, relation, to);
    const before = this.edges.get(id);
    const e: KGEdge = {
      id, from, to, relation,
      confidence: Math.max(0, Math.min(1, fields.confidence)),
      source: fields.source,
      status: fields.status ?? 'active',
      evidence: fields.evidence ?? before?.evidence ?? [],
      updatedAt: Date.now(),
    };
    this.edges.set(id, e);
    this.record({ kind: before ? 'update-edge' : 'add-edge', before: before ? { ...before } : null, after: { ...e } });
    return e;
  }

  edge(id: string): KGEdge | undefined {
    return this.edges.get(id);
  }

  /** Edges the reasoner may use. */
  activeEdges(): KGEdge[] {
    return [...this.edges.values()].filter((e) => e.status !== 'rejected');
  }

  outgoing(id: string): KGEdge[] {
    return [...this.edges.values()].filter((e) => e.from === id);
  }

  /** Undo the most recent group of edits made by `by` (default: user). Returns true if anything changed. */
  undo(by: KGChange['by'] = 'user'): boolean {
    let i = this.log.length - 1;
    while (i >= 0 && this.log[i].by !== by) i--;
    if (i < 0) return false;
    const g = this.log[i].group;
    const group = this.log.filter((c) => c.group === g);
    this.log = this.log.filter((c) => c.group !== g);
    for (const c of group.reverse()) {
      if (c.kind === 'add-node' || c.kind === 'remove-node') {
        if (c.before) this.nodes.set((c.before as KGNode).id, { ...(c.before as KGNode) });
        else if (c.after) this.nodes.delete((c.after as KGNode).id);
      } else {
        if (c.before) this.edges.set((c.before as KGEdge).id, { ...(c.before as KGEdge) });
        else if (c.after) this.edges.delete((c.after as KGEdge).id);
      }
    }
    this.changed();
    return true;
  }

  canUndo(by: KGChange['by'] = 'user'): boolean {
    return this.log.some((c) => c.by === by);
  }

  snapshot(): KGSnapshot {
    return {
      schemaVersion: KG_SCHEMA_VERSION,
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      edges: [...this.edges.values()].map((e) => ({ ...e })),
      log: this.log.slice(-MAX_LOG),
    };
  }

  load(s: KGSnapshot): void {
    this.nodes.clear();
    this.edges.clear();
    for (const n of s.nodes) this.nodes.set(n.id, { ...n });
    for (const e of s.edges) this.edges.set(e.id, { ...e });
    this.log = [...s.log];
    this.group = this.log.reduce((m, c) => Math.max(m, c.group), 0);
    this.changed();
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.log = [];
    this.changed();
  }
}
