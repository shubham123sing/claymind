/**
 * Multiplayer (Update 3, Step C), the room part: the panel (create / join by code, who is
 * in the room, kick, leave), the name, and plain messages when something goes wrong.
 * Presence, shared building and shared play listen to `room` themselves.
 */
import { createSystem, PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { SculptSystem } from '../sculpt/sculpt-system.js';
import { XR_TEXT_SCALE } from '../ui/canvas-panel.js';
import { CODE_KEYS, KeypadPanel, LETTERS } from '../ui/keypad.js';
import { room } from './room-client.js';
import { RoomPanel } from './room-panel.js';

const NAME_KEY = 'claymind.name';

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Player';
  } catch {
    return 'Player';
  }
}

export class MultiplayerSystem extends createSystem({}) {
  private panel = new RoomPanel();
  private keypad = new KeypadPanel(LETTERS);
  private codePad = new KeypadPanel(CODE_KEYS);
  private onTyped: ((text: string) => void) | null = null;
  private pad: KeypadPanel | null = null;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private v = new Vector3();
  private v2 = new Vector3();
  private tip = new Vector3();
  private attempt = 0;

  init(): void {
    this.panel.name = savedName();
    this.codePad.upper = true;
    this.codePad.max = 5;
    for (const [m, order] of [[this.panel.mesh, 24], [this.keypad.mesh, 26], [this.codePad.mesh, 26]] as const) {
      m.visible = false;
      m.renderOrder = order;
      (m.material as { depthTest: boolean }).depthTest = false;
      this.world.createTransformEntity(m);
    }
    this.cleanupFuncs.push(
      bus.on('multiplayer:toggle', () => (this.panel.mesh.visible ? this.close() : this.open())),
      room.on('players', () => this.syncRoom()),
      room.on('host', () => {
        this.syncRoom();
        if (room.isHost) this.toast('You are the host now');
      }),
    );
    room.onClose = (why) => {
      bus.emit('room:left', { why });
      this.panel.view = 'message';
      this.panel.message = why;
      this.panel.mesh.visible = true;
      this.panel.invalidate();
    };
    const onDown = (e: PointerEvent) => this.onPointer(e, true);
    const onMove = (e: PointerEvent) => this.onPointer(e, false);
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
    });
  }

  private toast(text: string): void {
    bus.emit('ui:toast', { text });
  }

  private open(): void {
    this.panel.view = room.connected ? 'room' : 'home';
    this.syncRoom();
    this.panel.mesh.visible = true;
    this.panel.invalidate();
    uiSounds.tick();
  }

  private close(): void {
    this.panel.mesh.visible = false;
    this.closePad();
  }

  private syncRoom(): void {
    const p = this.panel;
    p.code = room.code;
    p.players = [...room.players];
    p.me = room.me?.id ?? '';
    p.host = room.host;
    p.invalidate();
  }

  // ---------- typing ----------

  private type(pad: KeypadPanel, title: string, done: (text: string) => void, fallback = ''): void {
    if (!input.xr && typeof prompt === 'function') {
      const t = prompt(title, fallback);
      if (t !== null && t.trim()) done(t.trim());
      return;
    }
    pad.title = title;
    pad.text = '';
    pad.mesh.visible = true;
    pad.invalidate();
    this.pad = pad;
    this.onTyped = done;
  }

  private closePad(): void {
    if (this.pad) this.pad.mesh.visible = false;
    this.pad = null;
    this.onTyped = null;
  }

  private padPress(id: string): void {
    const pad = this.pad;
    if (!pad) return;
    const r = pad.press(id);
    uiSounds.tick();
    if (!r) return;
    const done = this.onTyped, text = pad.text.trim();
    this.closePad();
    if (r === 'done' && done && text) done(text);
  }

  // ---------- room ----------

  private async connect(code?: string): Promise<void> {
    const p = this.panel, my = ++this.attempt;
    p.view = 'busy';
    p.status = code ? `Joining room ${code}…` : 'Creating a room…';
    p.invalidate();
    try {
      await room.open(p.name, code);
      if (my !== this.attempt) return room.leave();
      p.view = 'room';
      this.syncRoom();
      bus.emit('room:joined', { code: room.code, host: room.isHost });
      uiSounds.chime();
    } catch (e) {
      if (my !== this.attempt) return;
      p.view = 'message';
      p.message = e instanceof Error ? e.message : 'Could not reach the room server.';
      p.invalidate();
    }
  }

  private press(id: string): void {
    const p = this.panel;
    uiSounds.tick();
    if (id === 'close') return this.close();
    if (id === 'name') {
      this.type(this.keypad, 'Your name in the room', (t) => {
        p.name = t.slice(0, 16);
        try {
          localStorage.setItem(NAME_KEY, p.name);
        } catch {
          /* private mode */
        }
        p.invalidate();
      }, p.name);
    } else if (id === 'create') void this.connect();
    else if (id === 'join') this.type(this.codePad, 'Room code (5 letters and digits)', (t) => void this.connect(t.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    else if (id === 'cancel') {
      this.attempt++;
      p.view = 'home';
    } else if (id === 'leave') room.leave();
    else if (id.startsWith('kick:')) room.send('kick', { id: id.slice(5) });
    else if (id === 'ok') p.view = room.connected ? 'room' : 'home';
    p.invalidate();
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (input.xr || e.target !== this.world.renderer.domElement) return;
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    if (!this.panel.mesh.visible) return;
    const h = this.ray.intersectObject(this.panel.mesh, false)[0];
    const id = h?.uv ? this.panel.regionAtUv(h.uv) : null;
    this.panel.setHover(id);
    if (!down || !h) return;
    e.stopImmediatePropagation();
    if (id) this.press(id);
  }

  private place(): void {
    const eye = this.world.camera.getWorldPosition(this.v2);
    const at = this.world.getSystem(SculptSystem)!.clayCenterWorld(this.v);
    const toEye = this.tip.copy(eye).sub(at).setY(0).normalize();
    const xr = input.xr;
    const m = this.panel.mesh;
    m.scale.setScalar(xr ? XR_TEXT_SCALE : 0.5);
    m.position.copy(at).addScaledVector(toEye, xr ? 0.12 : 0.14);
    m.position.y += xr ? 0.16 : 0.07;
    // browser: right of the clay, clear of the toolbar on the left of the screen
    if (!xr) m.position.x += toEye.z * 0.06, m.position.z -= toEye.x * 0.06;
    m.lookAt(eye);
    for (const k of [this.keypad.mesh, this.codePad.mesh]) {
      k.scale.setScalar(xr ? XR_TEXT_SCALE : 0.5);
      k.position.copy(m.position).addScaledVector(toEye, 0.04);
      k.position.y -= xr ? 0.06 : 0.02;
      k.lookAt(eye);
    }
  }

  update(): void {
    if (!this.panel.mesh.visible) return;
    const now = performance.now();
    this.place();
    if (input.xr) {
      const h = input.hands.right.tracked ? input.hands.right : input.hands.left;
      const tip = h.tracked ? this.tip.set(h.indexTip[0], h.indexTip[1], h.indexTip[2]) : null;
      if (this.pad) {
        const k = this.pad.poke(tip, now);
        if (k) this.padPress(k);
      } else {
        const id = this.panel.poke(tip, now);
        if (id) this.press(id);
      }
    }
    this.panel.draw();
    this.keypad.draw();
    this.codePad.draw();
  }
}
