/**
 * Pinch keypad: typing in the headset without a keyboard or a microphone (hands only,
 * no voice input by design). Big letter keys poked with a fingertip; Done hands the
 * text back. In the browser the normal prompt() is used instead.
 */
import { CanvasPanel, ui } from '../ui/canvas-panel.js';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const W = 1000, H = 520, K = 86, GAP = 8;

export class KeypadPanel extends CanvasPanel {
  title = '';
  text = '';
  max = 40;

  constructor() {
    super([W, H], [0.3, (0.3 * H) / W]);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(244,241,236,0.75)';
    ctx.font = '500 24px system-ui, sans-serif';
    ctx.fillText(this.title, 32, 38, W - 64);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(28, 62, W - 56, 64, 14);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(this.text + '▏', 44, 95, W - 88);
    ROWS.forEach((row, r) => {
      const x0 = (W - (row.length * (K + GAP) - GAP)) / 2;
      [...row].forEach((ch, i) => {
        const x = x0 + i * (K + GAP), y = 140 + r * (K + GAP), id = `k:${ch}`;
        add(x, y, K, K, id);
        ui.button(ctx, x, y, K, K, ch, { hover: this.hover === id });
      });
    });
    const y = 140 + 3 * (K + GAP);
    const keys: [string, string, number, string?][] = [['Cancel', 'cancel', 200], ['Space', 'space', 330], ['⌫', 'back', 150], ['Done', 'done', 220, '#5fbf72']];
    let x = 28;
    for (const [label, id, w, accent] of keys) {
      add(x, y, w, K, id);
      ui.button(ctx, x, y, w, K, label, { hover: this.hover === id, accent });
      x += w + 12;
    }
  }

  /** Returns 'done' / 'cancel' when finished, else null. */
  press(id: string): 'done' | 'cancel' | null {
    if (id === 'done') return 'done';
    if (id === 'cancel') return 'cancel';
    if (id === 'back') this.text = this.text.slice(0, -1);
    else if (id === 'space') this.text = (this.text + ' ').slice(0, this.max);
    else if (id.startsWith('k:')) this.text = (this.text + (this.text && !this.text.endsWith(' ') ? id[2].toLowerCase() : id[2])).slice(0, this.max);
    this.invalidate();
    return null;
  }
}
