/**
 * Play Kit panels (canvas, poke in XR, click in the browser):
 * - PlayKitPanel: tabs Kit (your toys: Place, Rename, Role, Duplicate, Remove),
 *   Sets (saved arrangements: Open, Rename, Delete) and Games (the five built-in
 *   games; pick one, check which toy plays each role, Play).
 * - GameHud: above the play area while a Set or game is open: name, scoreboard,
 *   the last message, and Edit/Play, Pause, Reset, Rules, Save Set, End.
 * Big targets (>= 56 px at 1000 px across = about 1.7 cm at panel scale 0.3 m, x1.25 in the headset).
 */
import { getMaterial } from '../materials/materials.js';
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import type { GameSpec } from './game-spec.js';
import type { KitItem, PlaySet } from './kit-store.js';

export type Tab = 'kit' | 'sets' | 'games';

const W = 1000, H = 700;

export class PlayKitPanel extends CanvasPanel {
  tab: Tab = 'kit';
  kit: KitItem[] = [];
  sets: PlaySet[] = [];
  games: GameSpec[] = [];
  selectedKit: string | null = null;
  selectedSet: string | null = null;
  /** Games tab: the game being set up (role mapping), or null for the list. */
  setup: { spec: GameSpec; roleMap: Record<string, string | null> } | null = null;
  armedRemove = false;
  canSaveSet = false;
  private images = new Map<string, HTMLImageElement>();

  constructor() {
    super([W, H], [0.3, (0.3 * H) / W]);
  }

  private image(k: KitItem): HTMLImageElement | null {
    let img = this.images.get(k.id + k.data.savedAt);
    if (!img) {
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = k.data.thumb;
      this.images.set(k.id + k.data.savedAt, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 36px system-ui, sans-serif';
    ctx.fillText('Play Kit', 32, 46);
    const tabs: [Tab, string][] = [['kit', `Kit (${this.kit.length})`], ['sets', `Sets (${this.sets.length})`], ['games', 'Games']];
    tabs.forEach(([id, label], i) => {
      const x = 220 + i * 190;
      add(x, 18, 176, 56, `tab:${id}`);
      ui.button(ctx, x, 18, 176, 56, label, { hover: this.hover === `tab:${id}`, accent: this.tab === id ? '#e2733b' : undefined });
    });
    add(W - 86, 18, 64, 56, 'close');
    ui.button(ctx, W - 86, 18, 64, 56, '×', { hover: this.hover === 'close' });
    if (this.tab === 'kit') this.paintKit(ctx, add);
    else if (this.tab === 'sets') this.paintSets(ctx, add);
    else if (this.setup) this.paintSetup(ctx, add);
    else this.paintGames(ctx, add);
  }

  private btn(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void, x: number, y: number, w: number, label: string, id: string, enabled = true, accent?: string): void {
    if (enabled) add(x, y, w, 56, id);
    ui.button(ctx, x, y, w, 56, label, { hover: this.hover === id, enabled, accent: enabled ? accent : undefined });
  }

  private paintKit(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const b = (x: number, w: number, label: string, id: string, enabled = true, accent?: string) => this.btn(ctx, add, x, 92, w, label, id, enabled, accent);
    b(20, 250, '+ Add current', 'kit:add', true, '#5fbf72');
    b(282, 210, 'Starter toys', 'kit:starter');
    b(504, 230, 'Download kit', 'kit:download', this.kit.length > 0);
    b(746, 230, 'Import', 'kit:import');
    if (!this.kit.length) {
      ctx.fillStyle = 'rgba(244,241,236,0.75)';
      ctx.font = '500 26px system-ui, sans-serif';
      ui.wrap(ctx, 'Your toy box is empty. Make something, bring it to life, then "+ Add current" (or "Add to Play Kit" in the menu).', 40, 230, W - 80, 36, 3);
    }
    const cols = 5, cw = (W - 40) / cols, ch = 200, top = 166;
    this.kit.slice(0, 10).forEach((k, i) => {
      const x = 20 + (i % cols) * cw, y = top + Math.floor(i / cols) * (ch + 10);
      const sel = this.selectedKit === k.id, hover = this.hover === `k:${k.id}`;
      ctx.fillStyle = sel ? 'rgba(240,180,41,0.35)' : hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(x + 5, y, cw - 10, ch, 18);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = '#f0b429';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      add(x + 5, y, cw - 10, ch, `k:${k.id}`);
      const img = this.image(k);
      if (img) ctx.drawImage(img, x + (cw - 104) / 2, y + 6, 104, 104);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 21px system-ui, sans-serif';
      ctx.fillText(k.name, x + cw / 2, y + 128, cw - 20);
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillStyle = '#f0b429';
      ctx.fillText(k.role, x + cw / 2, y + 156, cw - 20);
      ctx.fillStyle = 'rgba(244,241,236,0.65)';
      ctx.font = '500 16px system-ui, sans-serif';
      const [sx, sy, sz] = k.stats.sizeCm;
      ctx.fillText(`${Math.round(k.stats.massKg * 1000)} g · ${Math.round(Math.max(sx, sy, sz))} cm`, x + cw / 2, y + 182, cw - 20);
      ctx.textAlign = 'left';
    });
    const has = this.selectedKit !== null, by = H - 76;
    const sel = this.kit.find((k) => k.id === this.selectedKit);
    this.btn(ctx, add, 20, by, 150, 'Place', 'kit:place', has, '#5fbf72');
    this.btn(ctx, add, 178, by, 140, 'Rename', 'kit:rename', has);
    this.btn(ctx, add, 326, by, 200, sel ? `Role: ${sel.role}` : 'Role', 'kit:role', has);
    this.btn(ctx, add, 534, by, 150, 'Duplicate', 'kit:dup', has);
    this.btn(ctx, add, 692, by, 140, 'Share', 'kit:share', has, has ? '#5aa9e6' : undefined);
    this.btn(ctx, add, 840, by, 140, this.armedRemove ? 'Tap again' : 'Remove', 'kit:remove', has, has ? '#d9534f' : undefined);
  }

  private paintSets(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    this.btn(ctx, add, 20, 92, 380, 'Save table as a Set', 'set:save', this.canSaveSet, '#5fbf72');
    if (!this.sets.length) {
      ctx.fillStyle = 'rgba(244,241,236,0.75)';
      ctx.font = '500 26px system-ui, sans-serif';
      ui.wrap(ctx, 'No Sets yet. Place toys from your Kit (or start a game), arrange them on the table, then "Save table as a Set".', 40, 230, W - 80, 36, 3);
    }
    this.sets.slice(0, 6).forEach((s, i) => {
      const y = 166 + i * 74, sel = this.selectedSet === s.id, hover = this.hover === `s:${s.id}`;
      ctx.fillStyle = sel ? 'rgba(240,180,41,0.35)' : hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(20, y, W - 40, 64, 16);
      ctx.fill();
      add(20, y, W - 40, 64, `s:${s.id}`);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 24px system-ui, sans-serif';
      ctx.fillText(s.name, 40, y + 32, 420);
      ctx.fillStyle = 'rgba(244,241,236,0.7)';
      ctx.font = '500 20px system-ui, sans-serif';
      const game = s.game ? this.games.find((g) => g.id === s.game!.templateId)?.name ?? 'a game' : 'free play';
      ctx.fillText(`${s.pieces.length} pieces · ${game}`, 480, y + 32, W - 520);
    });
    const has = this.selectedSet !== null, by = H - 76;
    this.btn(ctx, add, 20, by, 300, 'Open', 'set:open', has, '#5fbf72');
    this.btn(ctx, add, 336, by, 300, 'Rename', 'set:rename', has);
    this.btn(ctx, add, 652, by, 328, this.armedRemove ? 'Tap again: delete' : 'Delete', 'set:delete', has, has ? '#d9534f' : undefined);
  }

  private paintGames(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    ctx.fillStyle = 'rgba(244,241,236,0.75)';
    ctx.font = '500 24px system-ui, sans-serif';
    ctx.fillText('Pick a game. Your toys play the parts that fit; built-in shapes fill the rest.', 32, 118, W - 64);
    this.games.forEach((g, i) => {
      const y = 146 + i * 90, hover = this.hover === `g:${g.id}`;
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(20, y, W - 40, 82, 16);
      ctx.fill();
      add(20, y, W - 40, 82, `g:${g.id}`);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(g.name, 40, y + 28, 360);
      ctx.fillStyle = 'rgba(244,241,236,0.75)';
      ctx.font = '500 21px system-ui, sans-serif';
      ctx.fillText(g.summary, 40, y + 60, W - 80);
      ctx.fillStyle = '#f0b429';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText(g.players > 1 ? `${g.players} players` : '1 player', W - 180, y + 28);
    });
    // the game agent (optional, needs the backend): any game, your own rules, or "look them up"
    this.btn(ctx, add, 20, H - 80, W - 40, 'Make a game with AI: any game or your own rules', 'games:agent', true, '#e2733b');
  }

  private paintSetup(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const { spec, roleMap } = this.setup!;
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(spec.name, 32, 120);
    ctx.fillStyle = 'rgba(244,241,236,0.75)';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText('Tap a part to change which toy plays it.', 32, 160);
    spec.roles.forEach((r, i) => {
      const y = 190 + i * 84, id = `r:${r.id}`, hover = this.hover === id;
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(20, y, W - 40, 74, 16);
      ctx.fill();
      add(20, y, W - 40, 74, id);
      ctx.fillStyle = '#f4f1ec';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(`${r.label} ×${r.count}`, 40, y + 37, 300);
      const k = roleMap[r.id] ? this.kit.find((x) => x.id === roleMap[r.id]) : null;
      ctx.fillStyle = k ? '#5fbf72' : 'rgba(244,241,236,0.75)';
      ctx.fillText(k ? `Your ${k.name}` : `Built-in ${r.fallback} (${getMaterial(r.material).name.toLowerCase()})`, 360, y + 37, W - 460);
      ctx.fillStyle = 'rgba(244,241,236,0.6)';
      ctx.fillText('▸', W - 70, y + 37);
    });
    const by = H - 76;
    this.btn(ctx, add, 20, by, 280, '◀ Back', 'setup:back');
    this.btn(ctx, add, 316, by, 280, 'Show me how', 'setup:demo', true, '#9fd0f5');
    this.btn(ctx, add, W - 384, by, 364, 'Play', 'setup:play', true, '#5fbf72');
  }
}

export class GameHud extends CanvasPanel {
  title = '';
  lines: string[] = [];
  message = '';
  rules: string[] = [];
  showRules = false;
  mode: 'edit' | 'play' = 'edit';
  paused = false;
  hasGame = false;
  over = false;
  /** second row: the demo controls while the demo hand plays */
  extra: [string, string, boolean, string?][] = [];

  constructor() {
    super([900, 500], [0.27, 0.15]);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const W2 = 900, H2 = 500;
    ui.panel(ctx, W2, H2);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(this.title, 28, 38, 480);
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = this.mode === 'play' ? '#5fbf72' : '#f0b429';
    ctx.fillText(this.paused ? 'PAUSED' : this.mode === 'play' ? 'PLAY' : 'EDIT: arrange the pieces', 520, 38, 360);
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '500 25px system-ui, sans-serif';
    const body = this.showRules ? this.rules : this.lines;
    body.slice(0, 4).forEach((l, i) => ctx.fillText(l, 28, 86 + i * 34, W2 - 56));
    if (this.message) {
      ctx.fillStyle = this.over ? '#f0b429' : '#9fd0f5';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(this.message, 28, 230, W2 - 56);
    }
    if (this.extra.length) {
      const n = this.extra.length, w2 = (W2 - 40 - (n - 1) * 8) / n;
      this.extra.forEach(([label, id, enabled, accent], i) => {
        const x = 20 + i * (w2 + 8);
        // 76 px rows: about 2.8 cm tall in the headset (fingertip targets, Step 5)
        if (enabled) add(x, H2 - 172, w2, 76, id);
        ui.button(ctx, x, H2 - 172, w2, 76, label, { hover: this.hover === id, enabled, accent: enabled ? accent : undefined });
      });
    }
    const by = H2 - 88, bw = (W2 - 40 - 5 * 8) / 6;
    const items: [string, string, boolean, string?][] = [
      [this.mode === 'play' ? 'Edit' : 'Play', 'hud:mode', true, this.mode === 'edit' ? '#5fbf72' : undefined],
      [this.paused ? 'Resume' : 'Pause', 'hud:pause', this.mode === 'play'],
      ['Reset', 'hud:reset', true],
      [this.showRules ? 'Score' : 'Rules', 'hud:rules', this.hasGame],
      ['Save Set', 'hud:save', true],
      ['End', 'hud:end', true, '#d9534f'],
    ];
    items.forEach(([label, id, enabled, accent], i) => {
      const x = 20 + i * (bw + 8);
      if (enabled) add(x, by, bw, 76, id);
      ui.button(ctx, x, by, bw, 76, label, { hover: this.hover === id, enabled, accent: enabled ? accent : undefined });
    });
  }
}
