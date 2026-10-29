/**
 * The Multiplayer panel: Create room / Join room (the code on the pinch keypad, or typed in
 * the browser), then the room: its code in big letters, who is in it (colour, name, host),
 * Kick (host only) and Leave. Errors in plain words.
 */
import { CanvasPanel, ui } from '../ui/canvas-panel.js';
import type { RoomPlayer } from './room-client.js';

export type RoomView = 'home' | 'busy' | 'room' | 'message';

const W = 900, H = 640;

export class RoomPanel extends CanvasPanel {
  view: RoomView = 'home';
  name = '';
  status = '';
  message = '';
  code = '';
  players: RoomPlayer[] = [];
  me = '';
  host = '';
  note = '';
  /** The room server: ready, waking up (a free server sleeps), or not reachable. */
  server: 'online' | 'waking' | 'offline' = 'waking';

  constructor() {
    super([W, H], [0.27, (0.27 * H) / W]);
  }

  protected paint(ctx: CanvasRenderingContext2D, add: (x: number, y: number, w: number, h: number, id: string) => void): void {
    const btn = (x: number, y: number, w: number, h: number, label: string, id: string, accent?: string, enabled = true) => {
      if (enabled) add(x, y, w, h, id);
      ui.button(ctx, x, y, w, h, label, { hover: this.hover === id, accent: enabled ? accent : undefined, enabled });
    };
    const text = (t: string, x: number, y: number, size: number, color = '#f4f1ec', weight = 500, maxW = W - 80) => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.fillText(t, x, y, maxW);
    };
    ui.panel(ctx, W, H);
    ctx.textBaseline = 'middle';
    text('Multiplayer', 32, 46, 36, '#f4f1ec', 700);
    // beta: the room server is a free host that sleeps; single player never needs it
    ctx.fillStyle = 'rgba(240,180,41,0.18)';
    ctx.beginPath();
    ctx.roundRect(262, 28, 96, 38, 19);
    ctx.fill();
    text('BETA', 280, 48, 22, '#f0b429', 800);
    btn(W - 86, 18, 64, 56, '×', 'close');
    switch (this.view) {
      case 'home': {
        text(`You are "${this.name}"`, 40, 120, 28);
        btn(560, 92, 300, 56, 'Change name', 'name');
        btn(40, 190, W - 80, 110, 'Create a room', 'create', '#5fbf72');
        btn(40, 320, W - 80, 110, 'Join a room (enter its code)', 'join', '#5aa9e6');
        const [dot, line] = this.server === 'online' ? ['#5fbf72', 'Room server ready.']
          : this.server === 'waking' ? ['#f0b429', 'Room server waking up (a free server sleeps; up to a minute).']
          : ['#d9534f', 'Room server not reachable now: you can still try; playing alone works fully.'];
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(54, 466, 10, 0, Math.PI * 2);
        ctx.fill();
        text(line, 76, 467, 23, '#f4f1ec', 600, W - 116);
        ctx.fillStyle = 'rgba(244,241,236,0.7)';
        ctx.font = '500 23px system-ui, sans-serif';
        ui.wrap(ctx, 'Up to 4 players build on the same table and play the Play Kit games together. No voice: wave or give a thumbs-up to say hi.', 40, 520, W - 80, 32, 3);
        break;
      }
      case 'busy':
        text(this.status || 'Connecting…', 40, 200, 32, '#f4f1ec', 700);
        ctx.fillStyle = 'rgba(244,241,236,0.7)';
        ctx.font = '500 23px system-ui, sans-serif';
        ui.wrap(ctx, 'The free server can take up to a minute to wake up: this keeps trying by itself.', 40, 260, W - 80, 32, 2);
        btn(40, H - 90, 300, 64, 'Cancel', 'cancel');
        break;
      case 'room': {
        text('Room code', 40, 112, 24, 'rgba(244,241,236,0.7)');
        text(this.code.split('').join(' '), 40, 165, 64, '#f0b429', 800);
        text(this.me === this.host ? 'Tell the others this code.' : '', 420, 165, 22, 'rgba(244,241,236,0.7)', 500, 440);
        this.players.forEach((p, i) => {
          const y = 230 + i * 74;
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          ctx.beginPath();
          ctx.roundRect(40, y, W - 80, 64, 14);
          ctx.fill();
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(76, y + 32, 16, 0, Math.PI * 2);
          ctx.fill();
          const tags = [p.id === this.host ? 'host' : '', p.id === this.me ? 'you' : ''].filter(Boolean).join(', ');
          text(`${p.name}${tags ? `  (${tags})` : ''}`, 108, y + 33, 28, '#f4f1ec', 600, 520);
          if (this.me === this.host && p.id !== this.me) btn(W - 230, y + 6, 170, 52, 'Remove', `kick:${p.id}`, '#d9534f');
        });
        if (this.note) text(this.note, 40, H - 132, 22, '#9fd0f5');
        btn(40, H - 90, 320, 64, 'Leave room', 'leave', '#d9534f');
        break;
      }
      case 'message':
        ctx.fillStyle = '#f4f1ec';
        ctx.font = '600 30px system-ui, sans-serif';
        ui.wrap(ctx, this.message, 40, 180, W - 80, 42, 5);
        btn(40, H - 90, 300, 64, 'OK', 'ok', '#5fbf72');
        break;
    }
  }
}
