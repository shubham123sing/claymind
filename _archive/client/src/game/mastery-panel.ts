/** Mastery screen: how the brain improved with you (honest mechanisms: cache, corrections, beliefs, experiments). */
import type { MeshBasicMaterial } from '@iwsdk/core';
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import { masteryScore, mean, Metrics } from './metrics.js';

export interface MasteryView {
  m: Metrics;
  userBeliefs: number;
  kgNodes: number;
  kgEdges: number;
  aiCacheHits: number;
}

export class MasteryPanel extends CanvasPanel {
  private v: MasteryView | null = null;

  constructor() {
    super([900, 640], [0.3, 0.213]);
    // a modal over the brain graph: draw on top of nodes and edges
    (this.mesh.material as MeshBasicMaterial).depthTest = false;
    this.mesh.renderOrder = 20;
  }

  set(v: MasteryView): void {
    this.v = v;
    this.invalidate();
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const [W, H] = this.px;
    ui.panel(ctx, W, H);
    const v = this.v;
    if (!v) return;
    const m = v.m;
    const score = masteryScore(m, { userBeliefs: v.userBeliefs, kgNodes: v.kgNodes, kgEdges: v.kgEdges });
    // ring
    const cx = 150, cy = 170, r = 95;
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#e2733b';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#f4f1ec';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.fillText(String(score), cx, cy - 6);
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,241,236,0.7)';
    ctx.fillText('mastery', cx, cy + 44);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.fillText('What the brain learned with you', 290, 70, W - 320);

    const t = m.timeToObject;
    const first = t.length ? t[0] : 0, recent = mean(t.slice(-3));
    const ai = m.timeToAi;
    const acc = m.materialTotal ? Math.round((m.materialKept / m.materialTotal) * 100) : 0;
    const rows: [string, string][] = [
      ['Objects made', `${m.objects}`],
      ['Time to object', t.length ? `${first.toFixed(2)} s first → ${recent.toFixed(2)} s now` : '—'],
      ['AI answer', ai.length ? `${ai[0].toFixed(1)} s first → ${mean(ai.slice(-3)).toFixed(1)} s now · ${v.aiCacheHits} from memory` : 'not used yet'],
      ['Material guesses kept', m.materialTotal ? `${acc}% (${m.materialKept}/${m.materialTotal})` : '—'],
      ['Beliefs you taught or fixed', `${v.userBeliefs + m.beliefsFixed}`],
      ['Experiments run / skipped', `${m.experimentsRun} / ${m.experimentsSaved} (already known)`],
      ['Brain size', `${v.kgNodes} ideas · ${v.kgEdges} beliefs`],
    ];
    let y = 128;
    for (const [k, val] of rows) {
      ctx.fillStyle = 'rgba(244,241,236,0.65)';
      ctx.font = '500 25px system-ui, sans-serif';
      ctx.fillText(k, 290, y, 300);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(val, 560, y, W - 590);
      y += 44;
    }
    // sparkline of time-to-object
    if (t.length >= 2) {
      const x0 = 40, y0 = 330, w = 200, h = 70, max = Math.max(...t);
      ctx.strokeStyle = '#5aa9e6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      t.slice(-20).forEach((v2, i, arr) => {
        const px = x0 + (i / Math.max(1, arr.length - 1)) * w, py = y0 + h - (v2 / (max || 1)) * h;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = 'rgba(244,241,236,0.6)';
      ctx.font = '500 20px system-ui, sans-serif';
      ctx.fillText('time to object', x0, y0 + h + 24);
    }
    ctx.fillStyle = 'rgba(244,241,236,0.55)';
    ctx.font = '500 21px system-ui, sans-serif';
    ui.wrap(ctx, 'Faster and better through memory (cached answers), your corrections and experiments; not by training a model.', 40, H - 120, W - 80, 28, 2);
    add(W - 200, H - 76, 180, 60, 'close');
    ui.button(ctx, W - 200, H - 76, 180, 60, 'Close', { hover: this.hover === 'close' });
  }
}
