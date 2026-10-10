/**
 * Wires the agent into the room: its panel sits left of the brain graph, its
 * lab is the ExperimentSystem, questions are answered by poke or click, and
 * every outcome feeds the Mastery metrics.
 *   "Check my beliefs" (panel / menu / B key): Debug the Brain
 *   unsure material after Bring to life: the agent asks
 *   "Mastery" (menu / P key): the progress screen
 */
import { createSystem, Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { aiState } from '../ai/ai-state.js';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { loadMetrics, metrics, pushHistory, saveMetrics } from '../game/metrics.js';
import { MasteryPanel } from '../game/mastery-panel.js';
import { KGSystem } from '../kgview/kg-system.js';
import { getMaterial } from '../materials/materials.js';
import { ObjectSystem } from '../objects/object-system.js';
import { input } from '../platform/input/input-system.js';
import { idbGet, idbSet } from '../storage/idb.js';
import { Agent, AgentMemory, StepKind } from './agent.js';
import { AgentPanel } from './agent-panel.js';
import { ExperimentSystem } from './experiment-system.js';

const STEP_MS = 750;
const ASK_MATERIAL_BELOW = 0.5;
const ASK_MATERIAL_AFTER_MS = 7000;

export class AgentSystem extends createSystem({}) {
  private panel = new AgentPanel();
  private mastery = new MasteryPanel();
  private agent: Agent | null = null;
  private kg!: KGSystem;
  private objects!: ObjectSystem;
  private answer: ((id: string) => void) | null = null;
  private memory: AgentMemory = {};
  private bakedAt = new Map<string, { t: number; material: string; corrected: boolean }>();
  private asked = new Set<string>();
  private lastCacheHits = 0;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private tip = new Vector3();

  init(): void {
    this.kg = this.world.getSystem(KGSystem)!;
    this.objects = this.world.getSystem(ObjectSystem)!;
    const lab = this.world.getSystem(ExperimentSystem)!;
    this.kg.anchor.add(this.panel.mesh, this.mastery.mesh);
    this.panel.mesh.position.set(-0.43, 0.02, 0.03);
    this.panel.mesh.rotation.y = 0.45;
    this.mastery.mesh.position.set(0, 0, 0.09);
    this.mastery.mesh.visible = false;

    void loadMetrics();
    void Promise.race([idbGet<AgentMemory>('settings', 'agent-memory'), new Promise<undefined>((r) => setTimeout(r, 1500))]).then((m) => {
      if (m) this.memory = m;
      this.agent = new Agent(
        this.kg.brain,
        { dropCompare: () => lab.run('drop-compare'), dropBreak: (id) => lab.run('drop-break', id), bounce: (mat) => lab.run('bounce', mat) },
        {
          step: (kind, text) => this.step(kind, text),
          ask: (_q, options) => this.ask(options),
          thinking: (on) => this.panel.thinking(on),
        },
        this.memory,
        () => void idbSet('settings', 'agent-memory', this.memory),
      );
    });

    this.cleanupFuncs.push(
      bus.on('agent:check', () => void this.checkBeliefs()),
      bus.on('mastery:toggle', () => this.toggleMastery()),
      bus.on('creation:baked', (e) => {
        const c = e.creation;
        metrics.objects++;
        metrics.materialTotal++;
        metrics.materialKept++;
        pushHistory(metrics.timeToObject, c.timeToObject);
        saveMetrics();
        this.bakedAt.set(c.id, { t: performance.now(), material: c.materialId, corrected: false });
        setTimeout(() => void this.maybeAskMaterial(c.id), ASK_MATERIAL_AFTER_MS);
      }),
      bus.on('creation:described', (e) => {
        const b = this.bakedAt.get(e.creationId);
        if (b) pushHistory(metrics.timeToAi, (performance.now() - b.t) / 1000), saveMetrics();
      }),
      bus.on('object:material-set', (e) => {
        const b = this.bakedAt.get(e.creationId);
        if (e.by !== 'user' || !b) return;
        // a correction away from the guess (once per creation) lowers material accuracy
        if (!b.corrected && e.materialId !== b.material) {
          b.corrected = true;
          metrics.materialKept = Math.max(0, metrics.materialKept - 1);
          saveMetrics();
        }
      }),
    );
    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
  }

  private async step(kind: StepKind, text: string): Promise<void> {
    this.panel.push(kind, text);
    if (kind === 'update') uiSounds.bonk();
    else if (kind === 'report') uiSounds.chime();
    else uiSounds.tick();
    await new Promise((r) => setTimeout(r, STEP_MS));
  }

  private ask(options: { id: string; label: string; accent?: boolean }[]): Promise<string> {
    this.panel.setOptions(options);
    return new Promise((resolve) => {
      this.answer = (id) => {
        this.answer = null;
        this.panel.setOptions([]);
        uiSounds.tick(2);
        resolve(id);
      };
    });
  }

  private async checkBeliefs(): Promise<void> {
    if (!this.agent || this.agent.busy) return;
    this.kg.show();
    this.mastery.mesh.visible = false;
    this.panel.clear();
    const focus = this.kg.focusId;
    const out = await this.agent.checkBeliefs(focus, (id) => this.objects.creationById(id)?.materialId ?? null);
    if (out.ran) metrics.experimentsRun++;
    if (out.saved && !out.ran) metrics.experimentsSaved++;
    if (out.fixed) metrics.beliefsFixed++;
    saveMetrics();
    this.kg.refreshView();
  }

  private async maybeAskMaterial(creationId: string): Promise<void> {
    const c = this.objects.creationById(creationId);
    if (!c || !this.agent || this.agent.busy || this.asked.has(creationId) || c.materialConfidence >= ASK_MATERIAL_BELOW) return;
    if (this.bakedAt.get(creationId)?.corrected) return;
    this.asked.add(creationId);
    this.kg.show();
    this.panel.clear();
    const guesses = c.materialGuesses.length ? c.materialGuesses : [{ id: c.materialId, prob: c.materialConfidence }];
    const pick = await this.agent.askMaterial(c.name, guesses, (id) => getMaterial(id).name);
    if (!pick) return;
    if (pick === c.materialId) {
      // confirmed the guess: counts as kept; record it as the user's belief
      bus.emit('object:material-set', { creationId, materialId: pick, by: 'user', confidence: 1 });
    } else bus.emit('creation:set-material', { creationId, materialId: pick, by: 'user', confidence: 1 });
  }

  private toggleMastery(): void {
    this.kg.show();
    this.mastery.mesh.visible = !this.mastery.mesh.visible;
    if (this.mastery.mesh.visible) this.refreshMastery();
  }

  private refreshMastery(): void {
    const g = this.kg.brain.graph;
    let userBeliefs = 0;
    for (const e of g.edges.values()) if ((e.source === 'user' || e.source === 'experiment') && e.status === 'active') userBeliefs++;
    this.mastery.set({ m: metrics, userBeliefs, kgNodes: g.nodes.size, kgEdges: g.edges.size, aiCacheHits: metrics.aiCacheHits });
  }

  private press(panel: 'agent' | 'mastery', id: string): void {
    if (panel === 'mastery') {
      if (id === 'close') this.mastery.mesh.visible = false;
      return;
    }
    // the idle "Check my beliefs" button sits where answers were: ignore the
    // tail of a double tap / late poke right after answering
    const now = performance.now();
    if (now < this.pressCooldownUntil) return;
    if (this.answer) {
      this.pressCooldownUntil = now + 1200;
      this.answer(id);
    } else if (id === 'check') void this.checkBeliefs();
  }
  private pressCooldownUntil = 0;

  // ------------- mouse -------------

  private setNdc(e: PointerEvent): void {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
  }

  private hit(): { panel: 'agent' | 'mastery'; id: string | null } | null {
    if (!this.kg.isVisible) return null;
    const meshes: Mesh[] = [this.panel.mesh];
    if (this.mastery.mesh.visible) meshes.unshift(this.mastery.mesh);
    const h = this.ray.intersectObjects(meshes, false)[0];
    if (!h?.uv) return null;
    return h.object === this.mastery.mesh ? { panel: 'mastery', id: this.mastery.regionAtUv(h.uv) } : { panel: 'agent', id: this.panel.regionAtUv(h.uv) };
  }

  private onPointerDown(e: PointerEvent): void {
    if (input.xr || e.button !== 0 || e.target !== this.world.renderer.domElement) return;
    this.setNdc(e);
    const h = this.hit();
    if (!h) return;
    e.stopImmediatePropagation();
    if (h.id) this.press(h.panel, h.id);
  }

  private onPointerMove(e: PointerEvent): void {
    if (input.xr) return;
    this.setNdc(e);
    const h = this.hit();
    this.panel.setHover(h?.panel === 'agent' ? h.id : null);
    this.mastery.setHover(h?.panel === 'mastery' ? h.id : null);
  }

  // ------------- frame -------------

  update(): void {
    const now = performance.now();
    if (aiState.stats.cacheHits !== this.lastCacheHits) {
      metrics.aiCacheHits += aiState.stats.cacheHits - this.lastCacheHits;
      this.lastCacheHits = aiState.stats.cacheHits;
      saveMetrics();
    }
    if (!this.kg.isVisible) return;
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const tip = h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null;
      const m = this.mastery.mesh.visible ? this.mastery.poke(tip, now) : null;
      if (m) this.press('mastery', m);
      const a = this.panel.poke(tip, now);
      if (a) this.press('agent', a);
    }
    if (this.mastery.mesh.visible && Math.floor(now / 1000) !== Math.floor((now - 16) / 1000)) this.refreshMastery();
    this.panel.tick(now);
    this.panel.draw();
    this.mastery.draw();
  }
}
