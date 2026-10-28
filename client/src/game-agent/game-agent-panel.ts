/**
 * The game agent's panel, opened from Play Kit -> Games -> "Make a game with AI" (canvas,
 * poke in XR, click in the browser). Views: games (pick a game, type one, your own rules,
 * look them up) · rules (your own rules as number cards) · thinking · preview (Play / Show
 * me how / Adjust / Cancel) · adjust (the rules card) · message · describe (Point + Say: show the
 * pieces with your hands and say what they are, mark the goal or a path on the table) · confirm
 * (one short question when the hands were not clear) · explain (the rules in plain sentences).
 * A game made from a creation shows what the agent saw, its rule and why (V6, 4.2); every
 * tested game shows the Referee's badge.
 * Big targets; everything the agent says is shown with where it came from.
 */
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import type { GameAnswer } from './agent-client.js';
import type { Look } from './look.js';
import { ROLE_WORDS } from './intent.js';

export type View = 'games' | 'rules' | 'thinking' | 'preview' | 'adjust' | 'message' | 'describe' | 'confirm' | 'explain';

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

export const GAME_CARDS = ['Carrom', 'Bowling', 'Ring toss', 'Block tower', 'Marble race', 'Surprise me'];
const W = 1000, H = 700;

export class GameAgentPanel extends CanvasPanel {
  view: View = 'games';
  online: boolean | null = null;
  status = '';
  answer: GameAnswer | null = null;
  uses: string[] = [];
  numbers: RuleNumbers = { players: 1, maxTurns: 3, shotsPerTurn: 1, target: 0, timerSec: 0 };
  ruleText = '';
  problems: string[] = [];
  message = '';
  activity: string[] = [];
  showActivity = false;
  /** describe: what is understood so far, a hint line, what the hands are drawing */
  understood: string[] = [];
  hint = '';
  hintOk = true;
  marking: 'zone' | 'path' | null = null;
  canMake = false;
  /** confirm: the question and the answers (id, label) */
  question = '';
  options: [string, string][] = [];
  /** a game made from a creation: what the agent saw and why it chose the rule */
  look: Look | null = null;
  /** explain: the game in plain sentences */
  explained: string[] = [];

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

  /** A green pill (the Referee's check). */
  private badge(t: string, x: number, y: number): void {
    const c = this.ctx;
    c.font = '700 21px system-ui, sans-serif';
    const w = c.measureText(t).width + 32;
    c.fillStyle = 'rgba(95,191,114,0.22)';
    c.strokeStyle = '#5fbf72';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, w, 42, 21);
    c.fill();
    c.stroke();
    this.text(t, x + 16, y + 22, 21, '#7fdc92', 700, w);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    this.ctx = ctx;
    this.add = add;
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    this.text('Make a game', 32, 46, 36, '#f4f1ec', 700);
    const dot = this.online === null ? 'waking up…' : this.online ? 'online' : 'offline';
    this.text(dot, 270, 48, 22, this.online ? '#5fbf72' : '#f0b429', 600, 200);
    if (this.view !== 'games') this.btn(W - 250, 18, 150, 56, '◀ Back', 'back');
    this.btn(W - 86, 18, 64, 56, '×', 'close');
    const by = H - 76;
    switch (this.view) {
      case 'games': {
        this.text('Pick a game, or tell me your own rules.', 40, 110, 25, 'rgba(244,241,236,0.8)');
        GAME_CARDS.forEach((g, i) => this.btn(40 + (i % 3) * 312, 150 + Math.floor(i / 3) * 96, 296, 82, g, `game:${g}`, true, g === 'Surprise me' ? '#b48cf2' : undefined));
        this.btn(40, 360, 450, 82, 'Type a game name', 'game:type');
        this.btn(510, 360, 450, 82, 'My own rules', 'game:rules', true, '#e2733b');
        this.btn(40, 460, 450, 82, 'Look up the rules', 'game:lookup');
        this.btn(510, 460, 450, 82, 'Show me with my hands', 'game:describe', true, '#9fd0f5');
        if (this.showActivity) this.activity.slice(-3).forEach((l, i) => this.text(l, 40, 570 + i * 26, 18, 'rgba(244,241,236,0.7)', 500));
        else if (this.online === false) this.wrapped('The game agent is offline. The Play Kit and its five games work without it.', 565, 2, 22);
        else if (this.online === null) this.wrapped('The game agent is waking up (a free server, about a minute). Keep sculpting: the built-in games and "Show me with my hands" work now.', 565, 2, 22);
        this.btn(40, by, 330, 56, this.showActivity ? 'Hide activity' : 'Agent activity', 'activity');
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
        const st = this.status;
        this.wrapped(st.startsWith("I'm looking") ? 'Measuring its size and shape, its pieces and what they are made of.'
          : st.includes('physics') ? 'The Referee plays the game in the real physics before you do.'
          : 'This can take up to half a minute on the free models.', 260, 2);
        break;
      }
      case 'preview': {
        const a = this.answer!;
        this.text(a.preview.name, 40, 108, 32, '#f4f1ec', 700, 560);
        if (a.physics?.ok) this.badge('✓ Referee check passed', 620, 88);
        else this.text(a.note, 620, 110, 20, a.path === 'web' ? '#9fd0f5' : '#f0b429', 600, 340);
        let y = 150;
        const look = this.look;
        if (look) {
          // what the agent understood, then its rule and why
          ctx.fillStyle = 'rgba(159,208,245,0.10)';
          ctx.beginPath();
          ctx.roundRect(28, y - 22, W - 56, 44 + 32 * (look.seen.length + 2), 16);
          ctx.fill();
          this.text('I see', 44, y, 20, '#9fd0f5', 700);
          for (const l of look.seen) y = this.wrapped(`• ${l}`, y + 24, 1, 21) + 0;
          y = this.wrapped(`Rule: ${look.rule}`, y + 16, 1, 22, '#f4f1ec') + 2;
          y = this.wrapped(`Why: ${look.why}`, y, 1, 21, '#5fbf72') + 18;
        }
        for (const l of a.preview.howToPlay.slice(0, look ? 2 : 4)) y = this.wrapped(`• ${l}`, y, 1, 23) + 4;
        if (this.uses.length) y = this.wrapped(`Uses: ${this.uses.join(', ')}`, y + 6, 2, 21, '#5fbf72') + 4;
        // rules that could not be applied matter most, then what the kit lacks: alternate them
        const extra: string[] = [];
        for (let i = 0; i < 3; i++) {
          if (a.cannot[i]) extra.push(`Not possible: ${a.cannot[i]}`);
          if (a.preview.missing[i]) extra.push(`Missing: ${a.preview.missing[i]}`);
        }
        for (const l of extra.slice(0, 3)) y = this.wrapped(l, y, 1, 20, '#f0b429') + 2;
        if (a.sources.length) y = this.wrapped(`Sources: ${a.sources.map((s) => s.title).join(', ')} (Wikipedia)`, y + 4, 1, 19, 'rgba(159,208,245,0.9)');
        if (a.guessed) y = this.wrapped('Some of these rules are a guess: no source described them.', y + 4, 1, 19, '#d9534f');
        if (a.physics && !a.physics.ok) this.wrapped(`Physics test: ${a.physics.problems[0]}`, y + 4, 1, 19, '#f0b429');
        else if (a.physics) this.wrapped(`${look ? 'Made from your creation. ' : ''}The Referee played it in the real physics first: it works.`, y + 4, 1, 19, 'rgba(95,191,114,0.9)');
        this.btn(40, by, 180, 56, 'Play', 'preview:play', true, '#5fbf72');
        this.btn(232, by, 210, 56, 'Show me how', 'preview:demo', true, '#9fd0f5');
        this.btn(454, by, 170, 56, 'Explain', 'preview:explain');
        this.btn(636, by, 160, 56, 'Adjust', 'preview:adjust');
        this.btn(808, by, 152, 56, 'Cancel', 'back');
        break;
      }
      case 'explain': {
        this.text(`How "${this.answer?.preview.name ?? ''}" works`, 40, 108, 28, '#f4f1ec', 700);
        let y = 160;
        for (const l of this.explained.slice(0, 7)) y = this.wrapped(l, y, 2, 24, '#f4f1ec') + 12;
        this.btn(W - 360, by, 320, 56, 'Play', 'preview:play', true, '#5fbf72');
        break;
      }
      case 'describe': {
        this.text('Point at a piece or hold it up, then press what it is.', 40, 106, 23, 'rgba(244,241,236,0.8)');
        ROLE_WORDS.forEach((r, i) => this.btn(40 + (i % 3) * 312, 132 + Math.floor(i / 3) * 84, 296, 72, `This is the ${r}`, `chip:${r}`));
        this.btn(40, 300, 296, 72, 'Here is the goal', 'chip:here');
        this.btn(352, 300, 296, 72, this.marking === 'zone' ? 'Done marking' : 'Mark a zone', 'mark:zone', true, this.marking === 'zone' ? '#f0b429' : undefined);
        this.btn(664, 300, 296, 72, this.marking === 'path' ? 'Done drawing' : 'Draw a path', 'mark:path', true, this.marking === 'path' ? '#f0b429' : undefined);
        if (this.hint) this.text(this.hint, 40, 404, 22, this.hintOk ? '#5fbf72' : '#f0b429', 600);
        if (!this.understood.length) this.text('Nothing shown yet.', 40, 446, 22, 'rgba(244,241,236,0.6)');
        this.understood.slice(-4).forEach((l, i) => this.text(`• ${l}`, 40, 446 + i * 32, 22, '#f4f1ec', 500));
        this.btn(40, by, 250, 56, 'Type it', 'describe:type');
        this.btn(302, by, 200, 56, 'Clear', 'describe:clear');
        this.btn(W - 360, by, 320, 56, 'Make it', 'describe:make', this.canMake, '#5fbf72');
        break;
      }
      case 'confirm': {
        this.wrapped(this.question, 150, 2, 28, '#f4f1ec');
        this.options.forEach(([id, label], i) => this.btn(40, 250 + i * 96, W - 80, 82, label, `pick:${id}`, true, i === 0 ? '#f0b429' : undefined));
        this.btn(40, by, 300, 56, 'Neither: try again', 'pick:');
        break;
      }
      case 'message': {
        this.wrapped(this.message, 160, 6, 28, '#f4f1ec');
        break;
      }
    }
  }
}
