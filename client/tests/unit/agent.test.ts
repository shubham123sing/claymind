import { describe, expect, it } from 'vitest';
import { Agent, AgentLab, AgentMemory, AgentUi, planTests } from '../../src/agent/agent';
import { Brain } from '../../src/kg/brain';
import type { Creation } from '../../src/objects/creation';

function creation(over: Partial<Creation> = {}): Creation {
  return {
    schemaVersion: 1, id: 'c1', createdAt: 0, name: 'Ball', category: 'toy', source: 'template', templateId: 'ball', matchScore: 0.9,
    bestGuess: null, materialId: 'steel', materialConfidence: 0.8, materialGuesses: [], massKg: 0.9, sizeCm: [8, 8, 8], volumeCm3: 260,
    timeToObject: 0.1, kgNodeIds: [],
    descriptor: { aspect: 1, elong: 1, fill: 0.55, openTop: 0, holes: 0, profile: [0.8, 1, 1, 1, 0.8], angle: 0, center: [0, 0, 0], extents: [0.08, 0.08, 0.08], volume: 2.6e-4 },
    ...over,
  };
}

function rig(answers: string[], lab: Partial<AgentLab> = {}) {
  const log: string[] = [];
  const asked: string[] = [];
  const ui: AgentUi = {
    step: async (k, t) => void log.push(`${k}: ${t}`),
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? 'no';
    },
    thinking: () => {},
  };
  const calls: string[] = [];
  const fullLab: AgentLab = {
    dropCompare: async () => (calls.push('dropCompare'), { kind: 'drop-compare', heavyKg: 0.9, lightKg: 0.006, heavyMs: 286, lightMs: 286, deltaMs: 0, heightCm: 40 }),
    dropBreak: async () => (calls.push('dropBreak'), { kind: 'drop-break', broke: true, impactSpeed: 3.2, heightCm: 50, materialId: 'ceramic' }),
    bounce: async () => (calls.push('bounce'), { kind: 'bounce', reboundCm: 1, heightCm: 30, materialId: 'steel' }),
    ...lab,
  };
  const brain = new Brain();
  brain.seedIfEmpty();
  const memory: AgentMemory = {};
  return { brain, agent: new Agent(brain, fullLab, ui, memory, () => {}), log, asked, calls, memory };
}

const fallsFaster = (b: Brain, id: string) => b.predictions(id).find((p) => p.behaviorId === 'beh:falls_faster');

describe('agent: Debug the Brain (planted belief)', () => {
  it('tests "heavy things fall faster", disputes it, asks, and removes it on approval', async () => {
    const { brain, agent, log, asked, calls } = rig(['yes']);
    const id = brain.addCreation(creation());
    expect(fallsFaster(brain, id)!.confidence).toBeGreaterThan(0.5);
    expect(planTests(brain, id, () => 'steel')[0].kind).toBe('drop-compare');
    const out = await agent.checkBeliefs(id, () => 'steel');
    expect(calls).toEqual(['dropCompare']);
    expect(asked[0]).toMatch(/heavy things fall faster/);
    expect(out).toMatchObject({ ran: true, changed: true, fixed: true });
    expect(brain.graph.edge('prop:heavy|causes|beh:falls_faster')!.status).toBe('rejected');
    expect(fallsFaster(brain, id)).toBeUndefined();
    expect(log.at(-1)).toMatch(/falls faster \d+% → 0%/);
    expect(log.length).toBeLessThanOrEqual(8);
    // the user can still undo the agent-approved fix
    expect(brain.undo()).toBe(true);
    expect(brain.graph.edge('prop:heavy|causes|beh:falls_faster')!.status).toBe('disputed');
  });

  it('a light ball landing first never counts as support', async () => {
    const { brain, agent, asked } = rig(['yes'], {
      dropCompare: async () => ({ kind: 'drop-compare', heavyKg: 0.9, lightKg: 0.006, heavyMs: 313, lightMs: 286, deltaMs: -27, heightCm: 40 }),
    });
    const id = brain.addCreation(creation());
    await agent.checkBeliefs(id, () => 'steel');
    expect(asked[0]).toMatch(/heavy things fall faster/);
    expect(brain.graph.edge('prop:heavy|causes|beh:falls_faster')!.status).toBe('rejected');
  });

  it('keeping the belief lowers its confidence instead', async () => {
    const { brain, agent } = rig(['no']);
    const id = brain.addCreation(creation());
    await agent.checkBeliefs(id, () => 'steel');
    const e = brain.graph.edge('prop:heavy|causes|beh:falls_faster')!;
    expect(e.status).toBe('active');
    expect(e.confidence).toBeCloseTo(0.75 * 0.7, 6);
  });

  it('remembers experiments and does not repeat them while the belief is unchanged', async () => {
    const { brain, agent, calls, log } = rig(['no']);
    const id = brain.addCreation(creation());
    await agent.checkBeliefs(id, () => 'steel');
    const n = calls.length;
    // the "keep it" answer changed the belief, so the next check tests the next most useful thing
    await agent.checkBeliefs(id, () => 'steel');
    expect(calls.length).toBe(n + 1);
    // mark every plan as remembered with current versions -> nothing re-runs
    const all = planTests(brain, id, () => 'steel');
    const memory = (agent as unknown as { memory: AgentMemory }).memory;
    for (const p of all) memory[p.key] = { at: 0, beliefVersion: brain.graph.edge(p.edgeId)?.updatedAt ?? Infinity, summary: 'known.' };
    const out = await agent.checkBeliefs(id, () => 'steel');
    expect(out.saved).toBe(true);
    expect(calls.length).toBe(n + 1);
    expect(log.at(-1)).toMatch(/already tested/);
  });
});

describe('agent: break and bounce experiments', () => {
  it('a predicted break that happens raises confidence along the path', async () => {
    const { brain, agent } = rig([]);
    brain.cutEdge('prop:heavy|causes|beh:falls_faster');
    const id = brain.addCreation(creation({ id: 'c2', name: 'Mug', templateId: 'mug', materialId: 'ceramic', materialConfidence: 0.7, massKg: 0.3 }));
    const before = brain.graph.edge('mat:ceramic|has_property|prop:fragile')!.confidence;
    const plan = planTests(brain, id, () => 'ceramic').find((p) => p.kind === 'drop-break')!;
    expect(plan.prediction!.confidence).toBeGreaterThan(0.5);
    await (agent as unknown as { testBreak: (p: typeof plan, o: object) => Promise<void> }).testBreak(plan, {});
    expect(brain.graph.edge('mat:ceramic|has_property|prop:fragile')!.confidence).toBeCloseTo(Math.min(1, before + 0.1), 6);
  });

  it('a surprising break proposes learning "<material> is fragile"', async () => {
    const { brain, agent, asked } = rig(['yes'], {
      dropBreak: async () => ({ kind: 'drop-break', broke: true, impactSpeed: 3, heightCm: 50, materialId: 'plastic' }),
    });
    const id = brain.addCreation(creation({ id: 'c3', materialId: 'plastic', massKg: 0.2 }));
    const plan = planTests(brain, id, () => 'plastic').find((p) => p.kind === 'drop-break')!;
    await (agent as unknown as { testBreak: (p: typeof plan, o: object) => Promise<void> }).testBreak(plan, {});
    expect(asked[0]).toMatch(/Learn "Plastic is fragile"/);
    const e = brain.graph.edge('mat:plastic|has_property|prop:fragile')!;
    expect(e.source).toBe('experiment');
    expect(brain.predictions(id).some((p) => p.behaviorId === 'beh:breaks_when_dropped')).toBe(true);
  });

  it('a predicted bounce that does not happen disputes the bouncy belief', async () => {
    const { brain, agent, asked } = rig(['yes']);
    brain.connect('mat:steel', 'prop:bouncy'); // a wrong user belief
    const id = brain.addCreation(creation({ id: 'c4' }));
    const plan = planTests(brain, id, () => 'steel').find((p) => p.kind === 'bounce')!;
    await (agent as unknown as { testBounce: (p: typeof plan, o: object) => Promise<void> }).testBounce(plan, {});
    expect(asked[0]).toMatch(/barely bounced/);
    expect(brain.graph.edge('mat:steel|has_property|prop:bouncy')!.status).toBe('rejected');
  });
});
