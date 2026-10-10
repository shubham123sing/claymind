/** The agent's visible "thinking": its step log, questions with answer buttons, and its start button. */
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import type { StepKind } from './agent.js';

const ICON: Record<StepKind, string> = { observe: '◉', plan: '➜', act: '⚗', result: '▤', update: '!', ask: '?', report: '✓' };
const COLOR: Record<StepKind, string> = {
  observe: '#8fa3b8', plan: '#5aa9e6', act: '#f0a040', result: '#5fd3ff', update: '#ff6b5f', ask: '#f0b429', report: '#5fbf72',
};

export class AgentPanel extends CanvasPanel {
  private log: { kind: StepKind; text: string }[] = [];
  private options: { id: string; label: string; accent?: boolean }[] = [];
  private isThinking = false;
  private dots = 0;

  constructor() {
    super([768, 620], [0.24, 0.194]);
  }

  /** Screen-reader mirror of the agent's steps (also handy for tests). */
  private live = (() => {
    const el = document.createElement('div');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'log');
    el.id = 'agent-log';
    Object.assign(el.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' });
    document.body.appendChild(el);
    return el;
  })();

  push(kind: StepKind, text: string): void {
    const line = document.createElement('p');
    line.textContent = `Agent ${kind}: ${text}`;
    this.live.appendChild(line);
    while (this.live.childElementCount > 12) this.live.firstElementChild!.remove();
    this.log.push({ kind, text });
    if (this.log.length > 6) this.log.shift();
    this.invalidate();
  }

  clear(): void {
    this.log = [];
    this.invalidate();
  }

  setOptions(o: { id: string; label: string; accent?: boolean }[]): void {
    this.options = o;
    this.invalidate();
  }

  thinking(on: boolean): void {
    this.isThinking = on;
    this.invalidate();
  }

  tick(now: number): void {
    const d = Math.floor(now / 350) % 4;
    if (this.isThinking && d !== this.dots) {
      this.dots = d;
      this.invalidate();
    }
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const [W, H] = this.px;
    ui.panel(ctx, W, H);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 38px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.isThinking ? `Agent · thinking${'.'.repeat(this.dots)}` : 'Agent', 32, 46);
    let y = 100;
    if (!this.log.length) {
      ctx.fillStyle = 'rgba(244,241,236,0.75)';
      ctx.font = '500 27px system-ui, sans-serif';
      y = ui.wrap(ctx, 'I can test what I believe with real physics on your table, and I ask before changing anything.', 32, y, W - 64, 36, 3);
    }
    for (const s of this.log) {
      ctx.fillStyle = COLOR[s.kind];
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(ICON[s.kind], 32, y);
      ctx.fillStyle = s === this.log[this.log.length - 1] ? '#f4f1ec' : 'rgba(244,241,236,0.7)';
      ctx.font = '500 25px system-ui, sans-serif';
      y = ui.wrap(ctx, s.text, 72, y, W - 104, 31, 3) + 6;
      if (y > H - 110) break;
    }
    const opts = this.options.length ? this.options : this.isThinking ? [] : [{ id: 'check', label: 'Check my beliefs', accent: true }];
    if (!opts.length) return;
    const gap = 14, bw = (W - 40 - gap * (opts.length - 1)) / opts.length;
    opts.forEach((o, i) => {
      const x = 20 + i * (bw + gap), by = H - 88;
      add(x, by, bw, 68, o.id);
      ui.button(ctx, x, by, bw, 68, o.label, { hover: this.hover === o.id, accent: o.accent ? (this.hover === o.id ? '#f6c855' : '#e2733b') : undefined });
    });
  }
}
