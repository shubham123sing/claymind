/**
 * Forward-chaining reasoner over the Knowledge Graph (our code, no LLM).
 * Rules are generic patterns (kg/rules/*.json); domain knowledge lives in
 * editable graph edges, so editing the graph really changes conclusions.
 *
 * - Facts = non-rejected edges (disputed edges count at half confidence).
 * - Derived confidence = rule factor × product of premise confidences.
 * - For each derived fact the best derivation is kept, so every conclusion has
 *   an explicit reasoning path (ordered edge ids) for playback ("Why?").
 * - `contradicts` edges (P contradicts Q) weaken the weaker of two derived
 *   properties held by the same thing.
 */
import type { KGEdge, Relation } from './schema.js';

export interface Pattern {
  s: string;
  r: Relation;
  o: string;
}

export interface Rule {
  id: string;
  label: string;
  if: Pattern[];
  then: Pattern;
  factor: number;
}

export interface Fact {
  id: string;
  s: string;
  r: Relation;
  o: string;
  confidence: number;
  /** null = stored edge; otherwise how it was derived. */
  derivation: { rule: string; premises: string[] } | null;
}

export interface ReasoningResult {
  facts: Map<string, Fact>;
  /** Ordered stored-edge ids that justify a fact (premises first). */
  path(factId: string): string[];
  /** Rule ids used along the path, in order. */
  rulesFor(factId: string): string[];
}

const MAX_ITERATIONS = 6;

export function factId(s: string, r: string, o: string): string {
  return `${s}|${r}|${o}`;
}

export function reason(edges: KGEdge[], rules: Rule[]): ReasoningResult {
  const facts = new Map<string, Fact>();
  for (const e of edges) {
    if (e.status === 'rejected') continue;
    const confidence = e.status === 'disputed' ? e.confidence * 0.5 : e.confidence;
    facts.set(e.id, { id: e.id, s: e.from, r: e.relation, o: e.to, confidence, derivation: null });
  }

  for (let it = 0; it < MAX_ITERATIONS; it++) {
    let changed = false;
    // index facts by relation for joins
    const byRel = new Map<Relation, Fact[]>();
    for (const f of facts.values()) {
      let list = byRel.get(f.r);
      if (!list) byRel.set(f.r, (list = []));
      list.push(f);
    }
    for (const rule of rules) {
      for (const { binding, premises } of match(rule.if, byRel)) {
        const s = bind(rule.then.s, binding), o = bind(rule.then.o, binding);
        if (s === o) continue;
        const conf = rule.factor * premises.reduce((a, p) => a * p.confidence, 1);
        const id = factId(s, rule.then.r, o);
        const existing = facts.get(id);
        // stored edges win over derivations of the same triple; otherwise keep the strongest derivation
        if (existing && (existing.derivation === null || existing.confidence >= conf - 1e-9)) continue;
        facts.set(id, { id, s, r: rule.then.r, o, confidence: conf, derivation: { rule: rule.id, premises: premises.map((p) => p.id) } });
        changed = true;
      }
    }
    if (!changed) break;
  }

  if (applyContradictions(facts)) {
    // behaviours were derived from the un-weakened properties: re-derive them once
    for (const [id, f] of facts) if (f.derivation && f.r === 'has_behavior') facts.delete(id);
    const byRel = new Map<Relation, Fact[]>();
    for (const f of facts.values()) {
      let list = byRel.get(f.r);
      if (!list) byRel.set(f.r, (list = []));
      list.push(f);
    }
    for (const rule of rules) {
      if (rule.then.r !== 'has_behavior') continue;
      for (const { binding, premises } of match(rule.if, byRel)) {
        const s = bind(rule.then.s, binding), o = bind(rule.then.o, binding);
        const conf = rule.factor * premises.reduce((a, p) => a * p.confidence, 1);
        const id = factId(s, rule.then.r, o);
        const existing = facts.get(id);
        if (existing && existing.confidence >= conf) continue;
        facts.set(id, { id, s, r: rule.then.r, o, confidence: conf, derivation: { rule: rule.id, premises: premises.map((p) => p.id) } });
      }
    }
  }

  const path = (id: string, seen = new Set<string>()): string[] => {
    const f = facts.get(id);
    if (!f || seen.has(id)) return [];
    seen.add(id);
    if (!f.derivation) return [f.id];
    const out: string[] = [];
    for (const p of f.derivation.premises) for (const e of path(p, seen)) if (!out.includes(e)) out.push(e);
    return out;
  };
  const rulesFor = (id: string): string[] => {
    const f = facts.get(id);
    if (!f?.derivation) return [];
    return [...f.derivation.premises.flatMap((p) => rulesFor(p)), f.derivation.rule];
  };
  return { facts, path: (id) => path(id), rulesFor };
}

function bind(term: string, b: Map<string, string>): string {
  return term.startsWith('?') ? b.get(term)! : term;
}

/** All bindings satisfying every pattern (nested-loop join; the graph is small). */
function* match(patterns: Pattern[], byRel: Map<Relation, Fact[]>, i = 0, binding = new Map<string, string>(), premises: Fact[] = []): Generator<{ binding: Map<string, string>; premises: Fact[] }> {
  if (i === patterns.length) {
    yield { binding, premises };
    return;
  }
  const p = patterns[i];
  for (const f of byRel.get(p.r) ?? []) {
    const nb = unify(p.s, f.s, binding);
    if (!nb) continue;
    const nb2 = unify(p.o, f.o, nb);
    if (!nb2) continue;
    yield* match(patterns, byRel, i + 1, nb2, [...premises, f]);
  }
}

function unify(term: string, value: string, b: Map<string, string>): Map<string, string> | null {
  if (!term.startsWith('?')) return term === value ? b : null;
  const bound = b.get(term);
  if (bound !== undefined) return bound === value ? b : null;
  const nb = new Map(b);
  nb.set(term, value);
  return nb;
}

/** Returns true if any derived property was weakened. */
function applyContradictions(facts: Map<string, Fact>): boolean {
  const contra = [...facts.values()].filter((f) => f.r === 'contradicts' && !f.derivation);
  let any = false;
  if (!contra.length) return false;
  for (const c of contra) {
    for (const a of facts.values()) {
      if (a.r !== 'has_property' || a.o !== c.s) continue;
      const b = facts.get(factId(a.s, 'has_property', c.o));
      if (!b) continue;
      const [weak, strong] = a.confidence < b.confidence ? [a, b] : [b, a];
      if (!weak.derivation) continue; // never weaken stored facts
      weak.confidence *= 1 - strong.confidence * c.confidence;
      weak.derivation.premises.push(c.id);
      any = true;
    }
  }
  return any;
}
