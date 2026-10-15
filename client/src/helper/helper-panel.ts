/**
 * The "Ask AI" panel (canvas, poke in XR, click in the browser). Views:
 * home · games (pick a game) · rules (your own rules as number cards) · thinking ·
 * preview (Play / Adjust / Cancel) · adjust (the rules card) · teach (pick a thing) ·
 * guide (one step at a time, Check my work) · help (an answer and one safe fix) · message.
 * Big targets; everything the agent says is shown with where it came from.
 */
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import type { CoachStep, Fix, GameAnswer } from './helper-client.js';

export type View = 'home' | 'games' | 'rules' | 'thinking' | 'preview' | 'adjust' | 'teach' | 'guide' | 'help' | 'message';

export interface RuleNumbers {
  players: number;
  maxTurns: number;
  shotsPerTurn: number;
  target: number;
  timerSec: number;
}

export const RULE_LIMITS: Record<keyof RuleNumbers, [number, number, number, string]> = {
  players: [1, 4, 1, 'Players'],
  maxTurns: [0, 10, 1, 'Turns each (0 = no limit)'],
  shotsPerTurn: [0, 5, 1, 'Shots per turn (0 = no turns)'],
  target: [0, 20, 1, 'Win at (0 = most points)'],
  timerSec: [0, 180, 15, 'Time limit, s (0 = none)'],
};

export const GAME_CARDS = ['Carrom', 'Bowling', 'Ring toss', 'Jenga', 'Marble race', 'Surprise me'];
export const BUILD_CARDS = ['Cup', 'Mug', 'Bowl', 'Hammer', 'Ball', 'Ramp'];

const FIX_LABEL: Record<Fix, string> = {
  none: '', undo: 'Undo the last step', bring_to_life: 'Bring it to life', open_material: 'Pick a material', open_color: 'Pick a colour',
  reset_game: 'Reset the game', end_game: 'End the game',
};

const W = 1000, H = 700;

export class HelperPanel extends CanvasPanel {
  view: View = 'home';
  online: boolean | null = null;
  status = '';
  answer: GameAnswer | null = null;
  uses: string[] = [];
  numbers: RuleNumbers = { players: 1, maxTurns: 3, shotsPerTurn: 1, target: 0, timerSec: 0 };
  ruleText = '';
  problems: string[] = [];
  guideTitle = '';
  steps: CoachStep[] = [];
  stepIndex = 0;
  checkMessage = '';
  helpReply = '';
  fix: Fix = 'none';
  message = '';
  activity: string[] = [];
  showActivity = false;

  constructor() {
    super([W, H], [0.3, (0.3 * H) / W]);
  }

  private add!: (x: number, y: number, w: number, h: number, id: string) => void;
  private ctx!: CanvasRenderingContext2D;

  private btn(x: number, y: number, w: number, h: number, label: string, id: string, enabled = true, accent?: string): void {
    if (enabled) this.add(x, y, w, h, id);
    ui.button(this.ctx, x, y, w, h, label, { hover: this.hover === id, enabled, accent: enabled ? accent : undefined });
  }

  private text(t: string, x: number, y: number, size = 26, color = '#f4f1ec', weight = 500, maxW = W - 80): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    this.ctx.fillText(t, x, y, maxW);
  }

  private wrapped(t: string, y: number, lines = 3, size = 25, color = 'rgba(244,241,236,0.85)'): number {
    this.ctx.fillStyle = color;
    this.ctx.font = `500 ${size}px system-ui, sans-serif`;
    return ui.wrap(this.ctx, t, 40, y, W - 80, size + 9, lines);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    this.ctx = ctx;
    this.add = add;
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    this.text('Ask AI', 32, 46, 36, '#f4f1ec', 700);
    const dot = this.online === null ? 'checking…' : this.online ? 'online' : 'offline';
    this.text(dot, 180, 48, 22, this.online ? '#5fbf72' : '#f0b429', 600, 200);
    if (this.view !== 'home') this.btn(W - 250, 18, 150, 56, '◀ Back', 'back');
    this.btn(W - 86, 18, 64, 56, '×', 'close');
    const by = H - 76;
    switch (this.view) {
      case 'home': {
        this.btn(40, 110, W - 80, 110, 'Make a game from my kit', 'home:games', true, '#e2733b');
        this.btn(40, 236, W - 80, 110, 'Teach me to build something', 'home:teach', true, '#5aa9e6');
        this.btn(40, 362, W - 80, 110, "Help: I'm stuck", 'home:help', true, '#5fbf72');
        if (this.showActivity) this.activity.slice(-4).forEach((l, i) => this.text(l, 40, 500 + i * 30, 18, 'rgba(244,241,236,0.7)', 500));
        else if (this.online === false) this.wrapped('The AI helper is offline. The Play Kit and its five games work without it.', 510, 2);
        this.btn(40, by, 330, 56, this.showActivity ? 'Hide activity' : 'Agent activity', 'activity');
        break;
      }
      case 'games': {
        this.text('Pick a game, or tell me your own rules.', 40, 110, 25, 'rgba(244,241,236,0.8)');
        GAME_CARDS.forEach((g, i) => this.btn(40 + (i % 3) * 312, 150 + Math.floor(i / 3) * 96, 296, 82, g, `game:${g}`, true, g === 'Surprise me' ? '#b48cf2' : undefined));
        this.btn(40, 360, 450, 82, 'Type a game name', 'game:type');
        this.btn(510, 360, 450, 82, 'My own rules', 'game:rules', true, '#e2733b');
        this.btn(40, 460, W - 80, 82, "I don't know the rules: look them up", 'game:lookup');
        break;
      }
      case 'rules':
      case 'adjust': {
        this.text(this.view === 'adjust' ? `Adjust "${this.answer?.preview.name ?? ''}"` : 'Your rules', 40, 110, 28, '#f4f1ec', 700);
        (Object.keys(RULE_LIMITS) as (keyof RuleNumbers)[]).forEach((k, i) => {
          const y = 140 + i * 72;
          this.text(RULE_LIMITS[k][3], 40, y + 32, 24, '#f4f1ec', 500, 470);
          this.btn(560, y, 90, 62, '−', `num:${k}:-1`);
          this.text(String(this.numbers[k]), 690, y + 32, 30, '#f0b429', 700, 90);
          this.btn(780, y, 90, 62, '+', `num:${k}:1`);
        });
        if (this.ruleText) this.text(`"${this.ruleText}"`, 40, 520, 21, 'rgba(244,241,236,0.75)');
        if (this.problems.length) this.text(this.problems[0], 40, 555, 22, '#d9534f');
        if (this.view === 'rules') {
          this.btn(40, by, 300, 56, 'Type more rules', 'rules:type');
          this.btn(W - 360, by, 320, 56, 'Make my game', 'rules:send', true, '#5fbf72');
        } else {
          this.btn(W - 360, by, 320, 56, 'Check and play', 'adjust:play', true, '#5fbf72');
        }
        break;
      }
      case 'thinking': {
        this.text(this.status || 'Thinking…', 40, 200, 32, '#f4f1ec', 700);
        this.wrapped('This can take up to half a minute on the free models.', 260, 2);
        break;
      }
      case 'preview': {
        const a = this.answer!;
        this.text(a.preview.name, 40, 108, 32, '#f4f1ec', 700, 560);
        this.text(a.note, 620, 110, 20, a.path === 'web' ? '#9fd0f5' : '#f0b429', 600, 340);
        let y = 150;
        for (const l of a.preview.howToPlay.slice(0, 4)) y = this.wrapped(`• ${l}`, y, 1, 23) + 4;
        if (this.uses.length) y = this.wrapped(`Uses: ${this.uses.join(', ')}`, y + 6, 2, 21, '#5fbf72') + 4;
        // rules that could not be applied matter most, then what the kit lacks: alternate them
        const extra: string[] = [];
        for (let i = 0; i < 3; i++) {
          if (a.cannot[i]) extra.push(`Not possible: ${a.cannot[i]}`);
          if (a.preview.missing[i]) extra.push(`Missing: ${a.preview.missing[i]}`);
        }
        for (const l of extra.slice(0, 3)) y = this.wrapped(l, y, 1, 20, '#f0b429') + 2;
        if (a.sources.length) y = this.wrapped(`Sources: ${a.sources.map((s) => s.title).join(', ')} (Wikipedia)`, y + 4, 1, 19, 'rgba(159,208,245,0.9)');
        if (a.guessed) this.wrapped('Some of these rules are a guess: no source described them.', y + 4, 1, 19, '#d9534f');
        this.btn(40, by, 280, 56, 'Play', 'preview:play', true, '#5fbf72');
        this.btn(336, by, 280, 56, 'Adjust', 'preview:adjust');
        this.btn(632, by, 328, 56, 'Cancel', 'back');
        break;
      }
      case 'teach': {
        this.text('What would you like to build?', 40, 110, 25, 'rgba(244,241,236,0.8)');
        BUILD_CARDS.forEach((g, i) => this.btn(40 + (i % 3) * 312, 150 + Math.floor(i / 3) * 96, 296, 82, g, `build:${g}`));
        this.btn(40, 360, W - 80, 82, 'Type something else', 'build:type');
        break;
      }
      case 'guide': {
        const s = this.steps[this.stepIndex];
        this.text(`${this.guideTitle} · step ${this.stepIndex + 1} of ${this.steps.length}`, 40, 108, 26, '#f0b429', 700);
        let y = this.wrapped(s?.text ?? '', 160, 4, 30, '#f4f1ec');
        const detail = [s?.size_cm ? `about ${s.size_cm.map((v) => Math.round(v)).join(' × ')} cm` : '', s?.material ?? '', s?.color ?? ''].filter(Boolean).join(' · ');
        if (detail) y = this.wrapped(detail, y + 10, 1, 23, '#9fd0f5');
        if (this.checkMessage) this.wrapped(this.checkMessage, y + 20, 3, 25, this.checkMessage.startsWith('Looks good') ? '#5fbf72' : '#f0b429');
        this.btn(40, by, 160, 56, '◀', 'step:prev', this.stepIndex > 0);
        this.btn(216, by, 160, 56, '▶', 'step:next', this.stepIndex < this.steps.length - 1);
        this.btn(W - 400, by, 360, 56, 'Check my work', 'step:check', !!s, '#5aa9e6');
        break;
      }
      case 'help': {
        this.wrapped(this.helpReply || 'Looking at what you are doing…', 140, 6, 28, '#f4f1ec');
        if (this.fix !== 'none') this.btn(40, by, 520, 56, FIX_LABEL[this.fix], 'help:fix', true, '#5fbf72');
        break;
      }
      case 'message': {
        this.wrapped(this.message, 160, 6, 28, '#f4f1ec');
        break;
      }
    }
  }
}
