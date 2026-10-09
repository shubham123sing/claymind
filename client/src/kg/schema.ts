/**
 * Knowledge Graph schema (see docs/KG_SCHEMA.md). Persisted with schemaVersion;
 * every change to this format ships with a migration in kg/migrations.ts.
 */
export const KG_SCHEMA_VERSION = 1;

export type NodeType = 'Creation' | 'Concept' | 'ShapeFeature' | 'Material' | 'Property' | 'Behavior' | 'Context' | 'Challenge';

/** Stored relations. `has_behavior` is only ever produced by the reasoner. */
export type Relation =
  | 'is_a'
  | 'made_of'
  | 'has_feature'
  | 'has_property'
  | 'causes'
  | 'implies'
  | 'contradicts'
  | 'similar_to'
  | 'learned_from'
  | 'has_behavior';

export type EdgeSource = 'prior' | 'measurement' | 'vlm' | 'user' | 'experiment';
export type EdgeStatus = 'active' | 'disputed' | 'rejected';

export interface KGNode {
  id: string;
  type: NodeType;
  label: string;
  props: Record<string, unknown>;
  createdAt: number;
}

export interface KGEdge {
  id: string;
  from: string;
  to: string;
  relation: Relation;
  /** 0..1 */
  confidence: number;
  source: EdgeSource;
  status: EdgeStatus;
  evidence: string[];
  updatedAt: number;
}

export interface KGChange {
  at: number;
  kind: 'add-edge' | 'update-edge' | 'add-node' | 'remove-node';
  /** State before the change (null = did not exist). */
  before: KGEdge | KGNode | null;
  after: KGEdge | KGNode | null;
  /** Edits made together undo together. */
  group: number;
  /** Who made it (user edits are undoable from the UI). */
  by: 'user' | 'system';
}

export interface KGSnapshot {
  schemaVersion: number;
  nodes: KGNode[];
  edges: KGEdge[];
  log: KGChange[];
}

/** Source weight: user corrections count most (brief, section 6.5). */
export const SOURCE_COLORS: Record<EdgeSource, number> = {
  prior: 0x8fa3b8,
  measurement: 0x5fd3ff,
  vlm: 0xb48cf2,
  user: 0x5fbf72,
  experiment: 0xf0a040,
};
