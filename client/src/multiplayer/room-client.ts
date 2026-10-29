/**
 * The room connection (Update 3, Step C): one WebSocket to the relay (server/agents/rooms.py)
 * on the same backend as the game agent. Create a room or join one by code; then messages
 * with a type `t` (see the relay's docstring). No account: a name and a colour.
 *
 * Testing without a network: `?netLag=200` delays every message each way by about that
 * many ms (with some jitter) and `?netLoss=0.1` drops that share of presence and physics
 * state messages (edits are never dropped: the relay is ordered and reliable).
 */
import { agentsUrl } from '../game-agent/agent-client.js';

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
}

export type RoomMsg = { t: string; [k: string]: unknown };

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const LAG_MS = Number(params.get('netLag') ?? 0);
const LOSS = Number(params.get('netLoss') ?? 0);
const LOSSY = new Set(['presence', 'state']);

export function roomsUrl(): string | null {
  const base = agentsUrl();
  return base ? `${base.replace(/^http/, 'ws')}/v1/rooms` : null;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  code = '';
  me: RoomPlayer | null = null;
  host = '';
  players: RoomPlayer[] = [];
  private listeners = new Map<string, Set<(m: RoomMsg) => void>>();
  /** The connection ended (left, kicked, network). `lost`: not by choice (network, server restart): worth a rejoin. */
  onClose: (why: string, lost: { code: string } | null) => void = () => {};

  /** Listen to one message type ('*' = all), in arrival order; returns the unsubscribe. */
  on(t: string, fn: (m: RoomMsg) => void): () => void {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
    return () => this.listeners.get(t)?.delete(fn);
  }

  private emit(m: RoomMsg): void {
    for (const fn of this.listeners.get(m.t) ?? []) fn(m);
    for (const fn of this.listeners.get('*') ?? []) fn(m);
  }
  private closedWhy = '';
  sent = 0;
  received = 0;

  get isHost(): boolean {
    return !!this.me && this.me.id === this.host;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && !!this.me;
  }

  /** Create (no code) or join (code) a room. Resolves once in the room; rejects with a plain message. */
  open(name: string, code?: string): Promise<void> {
    if (this.ws) return Promise.reject(new Error('Leave this room first.'));
    const url = roomsUrl();
    if (!url) return Promise.reject(new Error('Multiplayer needs the ClayMind server: it is not set up here.'));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.ws = null;
          ws.close();
          reject(new Error('The room server did not answer (it may be waking up): try again.'));
        }
      }, 15000);
      ws.onopen = () => this.sendNow(code ? { t: 'join', code, name } : { t: 'create', name });
      ws.onmessage = (e) => this.later(() => {
        const m = JSON.parse(String(e.data)) as RoomMsg;
        if (LOSS && LOSSY.has(m.t) && Math.random() < LOSS) return;
        this.received++;
        if (!settled) {
          if (m.t === 'joined') {
            settled = true;
            clearTimeout(timer);
            this.code = String(m.code);
            this.me = m.you as RoomPlayer;
            this.host = String(m.host);
            this.players = m.players as RoomPlayer[];
            resolve();
          } else if (m.t === 'error') {
            settled = true;
            clearTimeout(timer);
            this.ws = null;
            ws.close();
            reject(new Error(String(m.message)));
          }
          return;
        }
        if (m.t === 'players') {
          this.players = m.players as RoomPlayer[];
          this.host = String(m.host);
        } else if (m.t === 'host') this.host = String(m.id);
        else if (m.t === 'kicked') this.closedWhy = 'The host removed you from the room.';
        this.emit(m);
      });
      ws.onclose = () => {
        if (settled && this.ws !== ws) return; // a refused or replaced connection
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.ws = null;
          reject(new Error('Could not reach the room server.'));
          return;
        }
        const why = this.closedWhy || 'Disconnected from the room.';
        const lost = this.closedWhy ? null : { code: this.code };
        this.reset();
        this.onClose(why, lost);
      };
    });
  }

  send(t: string, extra: Record<string, unknown> = {}): void {
    if (!this.connected) return;
    if (LOSS && LOSSY.has(t) && Math.random() < LOSS) return;
    this.sent++;
    this.later(() => this.sendNow({ t, ...extra }));
  }

  /** QA: drop the connection as a network failure would (no leave message). */
  dropForTest(): void {
    this.ws?.close();
  }

  leave(): void {
    if (!this.ws) return;
    this.closedWhy = 'You left the room.';
    this.sendNow({ t: 'leave' });
    this.ws.close();
  }

  private sendNow(m: RoomMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Simulated latency, keeping order like a real connection: one queue, released in order. */
  private queue: { at: number; fn: () => void }[] = [];
  private timer = 0;
  private later(fn: () => void): void {
    if (!LAG_MS) return fn();
    const last = this.queue[this.queue.length - 1]?.at ?? 0;
    this.queue.push({ at: Math.max(last, performance.now() + LAG_MS * (0.8 + Math.random() * 0.4)), fn });
    if (!this.timer) this.pump();
  }

  private pump(): void {
    this.timer = 0;
    const now = performance.now();
    while (this.queue.length && this.queue[0].at <= now) this.queue.shift()!.fn();
    if (this.queue.length) this.timer = window.setTimeout(() => this.pump(), Math.max(0, this.queue[0].at - now));
  }

  private reset(): void {
    this.ws = null;
    this.me = null;
    this.code = '';
    this.host = '';
    this.players = [];
    this.closedWhy = '';
  }
}

/** The one room connection of this page (other systems check `room.connected` / `room.isHost`). */
export const room = new RoomClient();
