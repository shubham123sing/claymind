/**
 * The brain's agent: tests its own beliefs with physics experiments and asks
 * the user before changing anything.
 *
 *   observe -> plan -> act (tool) -> observe result -> update -> ask -> report
 *
 * Tools: query_kg (Brain predictions/paths), run_experiment (ExperimentSystem),
 * propose_edit + ask_user (UI port; nothing changes without approval), explain.
 * At most 8 visible steps per task. Deterministic and offline: no LLM.
 * Memory: tests it already ran (and whose beliefs did not change since) are
 * not repeated; it reports the remembered answer instead.
 */
import type { Brain, Prediction } from '../kg/brain.js';
import type { Relation } from '../kg/schema.js';
import { PLANTED_BELIEFS } from '../kg/seed.js';
import type { BounceResult, DropBreakResult, DropCompareResult, ExperimentResult } from './experiment-system.js';

export type StepKind = 'observe' | 'plan' | 'act' | 'result' | 'update' | 'ask' | 'report';

export interface AgentUi {
  step(kind: StepKind, text: string): Promise<void>;
  /** Ask; resolves with the chosen option id. */
  ask(question: string, options: { id: string; label: string; accent?: boolean }[]): Promise<string>;
  thinking(on: boolean): void;
}

export interface AgentLab {
  dropCompare(): Promise<DropCompareResult>;
  dropBreak(creationId: string): Promise<DropBreakResult>;
  bounce(materialId: string): Promise<BounceResult>;
}

export interface AgentMemoryEntry {
  at: number;
  /** updatedAt of the tested belief when tested (re-test if the belief changed). */
  beliefVersion: number;
  summary: string;
}

export type AgentMemory = Record<string, AgentMemoryEntry>;

export interface TestPlan {
  key: string;
  kind: 'drop-compare' | 'drop-break' | 'bounce';
  /** Belief under test (stored edge id) or the one that would be added. */
  edgeId: string;
  behavior: string;
  prediction: Prediction | null;
  creationId: string | null;
  materialId: string | null;
  score: number;
  why: string;
}

export interface AgentOutcome {
  ran: boolean;
  saved: boolean;
  changed: boolean;
  fixed: boolean;
}

const MAX_STEPS = 8;
/** The heavy ball must land this much earlier to support "heavy things fall faster". */
const HEAVY_FIRST_MS = 20;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const label = (b: Brain, id: string) => b.graph.node(id)?.label ?? id.split(':')[1];

/** Which beliefs are worth testing now (best first). Pure: unit-tested. */
export function planTests(brain: Brain, focus: string | null, materialOf: (creationId: string) => string | null): TestPlan[] {
  const plans: TestPlan[] = [];
  const planted = new Set(PLANTED_BELIEFS.map((p) => p.edge));
  const preds = focus ? brain.predictions(focus) : [];
  const pred = (beh: string) => preds.find((p) => p.behaviorId === `beh:${beh}`) ?? null;
  const creationId = focus?.startsWith('cre:') ? focus.slice(4) : null;
  const mat = creationId ? materialOf(creationId) : null;

  // "heavy things fall faster": testable for anything (two balls)
  const ff = 'prop:heavy|causes|beh:falls_faster';
  const ffEdge = brain.graph.edge(ff);
  if (ffEdge && ffEdge.status !== 'rejected') {
    const p = pred('falls_faster');
    plans.push({
      key: 'drop-compare', kind: 'drop-compare', edgeId: ff, behavior: 'beh:falls_faster', prediction: p, creationId, materialId: null,
      score: (planted.has(ff) ? 2 : 1) * (p ? 1.5 : 1) * ffEdge.confidence,
      why: p ? `I predict your ${label(brain, focus!).toLowerCase()} falls faster (${pct(p.confidence)}) because heavy things fall faster.` : `I believe heavy things fall faster (${pct(ffEdge.confidence)}).`,
    });
  }
  if (creationId && mat) {
    const b = pred('breaks_when_dropped');
    const conf = b?.confidence ?? 0;
    plans.push({
      key: `drop-break:${mat}`, kind: 'drop-break', edgeId: `mat:${mat}|has_property|prop:fragile`, behavior: 'beh:breaks_when_dropped', prediction: b, creationId, materialId: mat,
      // most informative when unsure (near 50%)
      score: 0.9 * (1 - Math.abs(conf - 0.5)) + (b ? 0.2 : 0),
      why: b ? `I predict it breaks when dropped (${pct(conf)}).` : `I don't think it breaks when dropped.`,
    });
    const bo = pred('bounces');
    plans.push({
      key: `bounce:${mat}`, kind: 'bounce', edgeId: `mat:${mat}|has_property|prop:bouncy`, behavior: 'beh:bounces', prediction: bo, creationId, materialId: mat,
      score: 0.7 * (1 - Math.abs((bo?.confidence ?? 0) - 0.5)),
      why: bo ? `I predict it bounces (${pct(bo.confidence)}).` : `I don't think ${mat} bounces much.`,
    });
  }
  return plans.sort((a, z) => z.score - a.score);
}

export class Agent {
  private steps = 0;
  busy = false;

  constructor(private brain: Brain, private lab: AgentLab, private ui: AgentUi, private memory: AgentMemory, private saveMemory: () => void) {}

  private async step(kind: StepKind, text: string): Promise<void> {
    if (this.steps >= MAX_STEPS) return;
    this.steps++;
    await this.ui.step(kind, text);
  }

  /** "Debug the brain": test the most useful belief about the focused creation. */
  async checkBeliefs(focus: string | null, materialOf: (creationId: string) => string | null): Promise<AgentOutcome> {
    const out: AgentOutcome = { ran: false, saved: false, changed: false, fixed: false };
    if (this.busy) return out;
    this.busy = true;
    this.steps = 0;
    this.ui.thinking(true);
    try {
      const plans = planTests(this.brain, focus, materialOf);
      if (!plans.length) {
        await this.step('report', 'Nothing I can test right now. Bring something to life first.');
        return out;
      }
      // skip tests whose answer is remembered and whose belief has not changed since
      let plan = plans[0];
      for (const p of plans) {
        const mem = this.memory[p.key];
        const e = this.brain.graph.edge(p.edgeId);
        if (mem && (!e || e.updatedAt <= mem.beliefVersion)) {
          out.saved = true;
          continue;
        }
        plan = p;
        break;
      }
      const remembered = this.memory[plan.key];
      const edge = this.brain.graph.edge(plan.edgeId);
      if (remembered && (!edge || edge.updatedAt <= remembered.beliefVersion)) {
        await this.step('observe', plan.why);
        await this.step('report', `I already tested this: ${remembered.summary} No need to repeat it.`);
        out.saved = true;
        return out;
      }
      await this.step('observe', plan.why);
      const before = focus ? this.brain.predictions(focus) : [];
      if (plan.kind === 'drop-compare') await this.testFallSpeed(plan, out);
      else if (plan.kind === 'drop-break') await this.testBreak(plan, out);
      else await this.testBounce(plan, out);
      if (out.changed && focus) await this.step('report', diff(before, this.brain.predictions(focus)) || 'My beliefs are updated.');
      return out;
    } finally {
      this.ui.thinking(false);
      this.busy = false;
    }
  }

  private remember(plan: TestPlan, summary: string): void {
    this.memory[plan.key] = { at: Date.now(), beliefVersion: this.brain.graph.edge(plan.edgeId)?.updatedAt ?? Date.now(), summary };
    this.saveMemory();
  }

  private async testFallSpeed(plan: TestPlan, out: AgentOutcome): Promise<void> {
    await this.step('plan', 'Test: drop a heavy ball and a light ball from the same height at the same moment.');
    await this.step('act', 'Running the experiment on your table…');
    const r = await this.lab.dropCompare();
    out.ran = true;
    // only "the heavy ball clearly landed first" supports the belief
    const heavyFirst = r.deltaMs > HEAVY_FIRST_MS;
    const together = Math.abs(r.deltaMs) <= HEAVY_FIRST_MS;
    const g = (kg: number) => (kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 1000)} g`);
    await this.step('result', together
      ? `The ${g(r.heavyKg)} and ${g(r.lightKg)} balls landed together (within ${Math.max(1, Math.abs(r.deltaMs)).toFixed(0)} ms).`
      : `The ${heavyFirst ? g(r.heavyKg) : g(r.lightKg)} ball landed ${Math.abs(r.deltaMs).toFixed(0)} ms earlier.`);
    const summary = together ? 'heavy and light objects landed together.' : `the ${heavyFirst ? 'heavy' : 'light'} ball landed ${Math.abs(r.deltaMs).toFixed(0)} ms earlier.`;
    if (heavyFirst) {
      this.brain.confirmEdges([plan.edgeId], `experiment: heavy landed ${r.deltaMs.toFixed(0)} ms earlier`);
      this.remember(plan, summary);
      await this.step('report', 'The experiment agrees with my belief.');
      return;
    }
    await this.disputeAndAsk(plan, `experiment: ${g(r.heavyKg)} and ${g(r.lightKg)} balls dropped together; heavy did not land first (Δ ${r.deltaMs.toFixed(0)} ms)`,
      `That contradicts "heavy things fall faster". Remove this belief?`, out);
    this.remember(plan, summary);
  }

  private async testBreak(plan: TestPlan, out: AgentOutcome): Promise<void> {
    await this.step('plan', `Test: drop a copy of it from 50 cm and see if it breaks.`);
    await this.step('act', 'Dropping a copy on your table…');
    const r = await this.lab.dropBreak(plan.creationId!);
    out.ran = true;
    await this.step('result', r.broke ? `It broke (impact ${r.impactSpeed.toFixed(1)} m/s).` : `It did not break (impact ${r.impactSpeed.toFixed(1)} m/s).`);
    const predicted = plan.prediction?.confidence ?? 0;
    const summary = r.broke ? `${plan.materialId} broke from 50 cm.` : `${plan.materialId} survived a 50 cm drop.`;
    this.remember(plan, summary);
    if (r.broke && predicted >= 0.5) return this.confirm(plan, `experiment: broke from 50 cm`);
    if (!r.broke && predicted < 0.3) return this.confirm(plan, `experiment: survived 50 cm`);
    if (!r.broke && predicted >= 0.3) {
      const suspect = this.suspect(plan.prediction, 'prop:fragile');
      if (suspect) await this.disputeAndAsk({ ...plan, edgeId: suspect }, 'experiment: survived a 50 cm drop', `It did not break, so "${this.edgeText(suspect)}" looks wrong. Remove it?`, out);
      return;
    }
    // broke although not predicted: propose learning "<material> is fragile"
    await this.proposeAdd(`mat:${plan.materialId}`, 'has_property', 'prop:fragile', 'experiment: broke from 50 cm',
      `It broke although I did not expect it. Learn "${label(this.brain, `mat:${plan.materialId}`)} is fragile"?`, out);
  }

  private async testBounce(plan: TestPlan, out: AgentOutcome): Promise<void> {
    await this.step('plan', `Test: drop a ${plan.materialId} ball from 30 cm and measure the bounce.`);
    await this.step('act', 'Dropping it on your table…');
    const r = await this.lab.bounce(plan.materialId!);
    out.ran = true;
    const bounced = r.reboundCm >= 3;
    await this.step('result', `It bounced back ${r.reboundCm.toFixed(1)} cm of ${r.heightCm} cm: ${bounced ? 'a real bounce' : 'barely'}.`);
    const predicted = plan.prediction?.confidence ?? 0;
    this.remember(plan, `${plan.materialId} bounced ${r.reboundCm.toFixed(0)} cm from 30 cm.`);
    if (bounced === predicted >= 0.3) return this.confirm(plan, `experiment: rebound ${r.reboundCm.toFixed(1)} cm`);
    if (!bounced) {
      const suspect = this.suspect(plan.prediction, 'prop:bouncy');
      if (suspect) await this.disputeAndAsk({ ...plan, edgeId: suspect }, `experiment: rebound only ${r.reboundCm.toFixed(1)} cm`, `It barely bounced, so "${this.edgeText(suspect)}" looks wrong. Remove it?`, out);
      return;
    }
    await this.proposeAdd(`mat:${plan.materialId}`, 'has_property', 'prop:bouncy', `experiment: rebound ${r.reboundCm.toFixed(1)} cm`,
      `It bounced although I did not expect it. Learn "${label(this.brain, `mat:${plan.materialId}`)} is bouncy"?`, out);
  }

  /** The belief most likely at fault: the stored edge into the property on the prediction's path. */
  private suspect(p: Prediction | null, property: string): string | null {
    if (!p) return null;
    const into = p.path.filter((id) => id.endsWith(`|${property}`) && !id.startsWith('cre:'));
    return into[0] ?? p.path.find((id) => id.startsWith(property)) ?? null;
  }

  private edgeText(edgeId: string): string {
    const [from, rel, to] = edgeId.split('|');
    return `${label(this.brain, from)} ${rel.replace('_', ' ')} ${label(this.brain, to)}`;
  }

  private async confirm(plan: TestPlan, evidence: string): Promise<void> {
    if (plan.prediction) this.brain.confirmEdges(plan.prediction.path, evidence);
    await this.step('report', 'The experiment agrees with what I believed. I am a little more confident now.');
  }

  private async disputeAndAsk(plan: TestPlan, evidence: string, question: string, out: AgentOutcome): Promise<void> {
    this.brain.disputeEdge(plan.edgeId, evidence);
    out.changed = true;
    await this.step('update', `Marked "${this.edgeText(plan.edgeId)}" as disputed (it is pulsing red in the graph).`);
    await this.step('ask', question);
    const answer = await this.ui.ask(question, [
      { id: 'yes', label: 'Remove it', accent: true },
      { id: 'no', label: 'Keep it' },
    ]);
    this.brain.resolveDispute(plan.edgeId, answer === 'yes');
    out.fixed = answer === 'yes';
    if (answer !== 'yes') await this.step('report', 'Kept it, but I am less sure about it now.');
  }

  private async proposeAdd(from: string, rel: Relation, to: string, evidence: string, question: string, out: AgentOutcome): Promise<void> {
    await this.step('ask', question);
    const answer = await this.ui.ask(question, [
      { id: 'yes', label: 'Learn it', accent: true },
      { id: 'no', label: 'Not now' },
    ]);
    if (answer === 'yes') {
      this.brain.addLearnedEdge(from, rel, to, evidence);
      out.changed = out.fixed = true;
    }
  }

  /** Ask about the material when unsure. Resolves with the chosen material id, or null. */
  async askMaterial(name: string, guesses: { id: string; prob: number }[], labelOf: (id: string) => string): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    this.steps = 0;
    try {
      const top = guesses.slice(0, 3);
      const q = `I'm not sure what this ${name.toLowerCase()} is made of (${top.map((g) => `${labelOf(g.id).toLowerCase()} ${pct(g.prob)}`).join(', ')}). Which is it?`;
      await this.step('ask', q);
      const a = await this.ui.ask(q, [...top.map((g, i) => ({ id: g.id, label: labelOf(g.id), accent: i === 0 })), { id: 'skip', label: 'Not sure' }]);
      if (a === 'skip') return null;
      await this.step('report', `Thanks: ${labelOf(a).toLowerCase()}. I'll remember that for shapes like this.`);
      return a;
    } finally {
      this.busy = false;
    }
  }
}

/** "falls faster 65% → 0% · bounces 50% → 57%" */
export function diff(before: Prediction[], after: Prediction[]): string {
  const out: string[] = [];
  const ids = new Set([...before.map((p) => p.behaviorId), ...after.map((p) => p.behaviorId)]);
  for (const id of ids) {
    const a = before.find((p) => p.behaviorId === id), b = after.find((p) => p.behaviorId === id);
    const va = a?.confidence ?? 0, vb = b?.confidence ?? 0;
    if (Math.abs(va - vb) >= 0.05) out.push(`${(a ?? b)!.label} ${pct(va)} → ${pct(vb)}`);
  }
  return out.length ? `Updated: ${out.slice(0, 3).join(' · ')}` : '';
}
