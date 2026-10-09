/**
 * Debug HUD: one set of key/value lines shown both as a DOM overlay (browser)
 * and as a world-locked canvas panel (visible inside XR). Redraws at ~5 Hz.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, World } from '@iwsdk/core';

export class Hud {
  private lines = new Map<string, string>();
  private dom: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;
  private lastDraw = 0;
  private dirty = true;

  constructor(world: World) {
    this.dom = document.createElement('div');
    Object.assign(this.dom.style, {
      position: 'fixed', right: '12px', top: '12px', zIndex: '10', whiteSpace: 'pre',
      background: 'rgba(0,0,0,.62)', color: '#e8e8ea', padding: '10px 12px', borderRadius: '10px',
      font: '12px/1.45 ui-monospace, monospace', pointerEvents: 'none',
    });
    document.body.appendChild(this.dom);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const panel = new Mesh(
      new PlaneGeometry(0.4, 0.25),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    // Left of the table, angled toward a seated user; within ~70 cm reach.
    panel.position.set(-0.5, 1.15, -0.65);
    panel.rotation.y = 0.5;
    panel.renderOrder = 10;
    world.createTransformEntity(panel);
  }

  set(key: string, value: string): void {
    if (this.lines.get(key) === value) return;
    this.lines.set(key, value);
    this.dirty = true;
  }

  /** Call once per frame; cheap when nothing changed. */
  tick(now: number): void {
    if (!this.dirty || now - this.lastDraw < 200) return;
    this.lastDraw = now;
    this.dirty = false;
    const text = [...this.lines].map(([k, v]) => `${k.padEnd(9)} ${v}`).join('\n');
    this.dom.textContent = text;

    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(12,14,18,0.82)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 32);
    ctx.fill();
    ctx.fillStyle = '#f1f1f3';
    ctx.font = '26px monospace';
    let y = 48;
    for (const line of text.split('\n')) {
      ctx.fillText(line.slice(0, 66), 28, y);
      y += 36;
      if (y > canvas.height - 12) break;
    }
    this.texture.needsUpdate = true;
  }
}
