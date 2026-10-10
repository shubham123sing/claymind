/**
 * Visuals for the live sculpt: chunk meshes under a transform group, a soft
 * contact shadow, a size readout (label + ring on the surface) and brush cursors.
 * Each piece of clay has its own tint so the player can see the pieces.
 */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, RingGeometry, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial,
} from '@iwsdk/core';
import type { SculptResponse } from './sdf-worker.js';

export class ClayView {
  /** Moves/rotates/scales the sculpt. Grid-local coordinates live inside it. */
  readonly root = new Group();
  readonly material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0 });
  /** Surface-aligned group (not rotated/scaled with the clay). */
  readonly ground = new Group();
  readonly cursors: Mesh[] = [];
  private chunks = new Map<number, Mesh>();
  private shadow: Mesh;
  private ring: Mesh;
  private label: Sprite;
  private labelCanvas = document.createElement('canvas');
  private labelTex: CanvasTexture;
  private labelText = '';
  private status: Sprite;
  private statusCanvas = document.createElement('canvas');
  private statusTex: CanvasTexture;
  private statusText = '';
  triangles = 0;

  constructor() {
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.0015;
    this.shadow.renderOrder = 1;
    this.ground.add(this.shadow);

    this.ring = new Mesh(
      new RingGeometry(0.995, 1, 96),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.002;
    this.ground.add(this.ring);

    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.labelTex = new CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = SRGBColorSpace;
    this.label = new Sprite(new SpriteMaterial({ map: this.labelTex, transparent: true, depthWrite: false }));
    this.label.scale.set(0.12, 0.03, 1); // ~2.5 cm text height at arm's length
    this.label.renderOrder = 5;
    this.ground.add(this.label);

    this.statusCanvas.width = 768;
    this.statusCanvas.height = 128;
    this.statusTex = new CanvasTexture(this.statusCanvas);
    this.statusTex.colorSpace = SRGBColorSpace;
    this.status = new Sprite(new SpriteMaterial({ map: this.statusTex, transparent: true, depthWrite: false, depthTest: false }));
    this.status.scale.set(0.18, 0.03, 1);
    this.status.renderOrder = 6;
    this.status.visible = false;
    this.ground.add(this.status);

    for (let i = 0; i < 2; i++) {
      const c = new Mesh(
        new SphereGeometry(1, 20, 12),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      c.visible = false;
      c.renderOrder = 4;
      this.cursors.push(c);
    }
  }

  /** Apply a worker mesh update. */
  apply(m: SculptResponse, resChanged: boolean): void {
    if (resChanged) {
      for (const mesh of this.chunks.values()) {
        this.root.remove(mesh);
        mesh.geometry.dispose();
      }
      this.chunks.clear();
    }
    for (const c of m.chunks) {
      let mesh = this.chunks.get(c.chunk);
      if (c.positions.length === 0) {
        if (mesh) {
          this.root.remove(mesh);
          mesh.geometry.dispose();
          this.chunks.delete(c.chunk);
        }
        continue;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(c.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(c.normals, 3));
      geo.setAttribute('color', new BufferAttribute(pieceColors(c.labels), 3));
      geo.computeBoundingSphere();
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geo;
      } else {
        mesh = new Mesh(geo, this.material);
        mesh.castShadow = false;
        this.chunks.set(c.chunk, mesh);
        this.root.add(mesh);
      }
    }
    let tris = 0;
    for (const mesh of this.chunks.values()) tris += mesh.geometry.getAttribute('position').count / 3;
    this.triangles = tris;
  }

  /**
   * Detached copies of the current chunk meshes with baked world matrices, for
   * raycasting against the surface as it is now. Old geometries keep their CPU
   * arrays after dispose(), so this stays valid while the live mesh changes.
   */
  snapshot(): Mesh[] {
    this.root.updateMatrixWorld(true);
    return [...this.chunks.values()].map((m) => {
      const copy = new Mesh(m.geometry, this.material);
      copy.matrixAutoUpdate = false;
      copy.matrixWorld.copy(m.matrixWorld);
      return copy;
    });
  }

  /** All chunk meshes (for raycasting). */
  meshes(): Mesh[] {
    return [...this.chunks.values()];
  }

  /**
   * Update shadow/ring/label from the world-space footprint of the clay.
   * `sizeCm` = [w, h, d] in cm; `radius` = footprint radius (m); `height` = top above surface (m).
   */
  updateMeasure(sizeCm: number[], radius: number, height: number): void {
    this.shadow.scale.set(radius * 2.6, radius * 2.6, 1);
    this.ring.scale.set(radius + 0.012, radius + 0.012, 1);
    this.label.position.set(0, height + 0.035, 0);
    this.status.position.set(0, height + 0.075, 0);
    const text = `${sizeCm[0].toFixed(1)} × ${sizeCm[1].toFixed(1)} × ${sizeCm[2].toFixed(1)} cm`;
    if (text === this.labelText) return;
    this.labelText = text;
    const ctx = this.labelCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(16,18,22,0.72)';
    ctx.beginPath();
    ctx.roundRect(8, 16, 496, 96, 48);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '600 50px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 66);
    this.labelTex.needsUpdate = true;
  }

  /** One-line status above the clay ("Looking…", "Mug? · Ceramic 65%"); null hides it. */
  setStatus(text: string | null, accent = '#e2733b'): void {
    this.status.visible = text !== null;
    if (text === null || text === this.statusText) return;
    this.statusText = text;
    const ctx = this.statusCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 768, 128);
    ctx.fillStyle = 'rgba(16,18,22,0.8)';
    ctx.beginPath();
    ctx.roundRect(8, 16, 752, 96, 48);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(64, 64, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.font = '600 46px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 96, 66, 640);
    this.statusTex.needsUpdate = true;
  }

  /** Clay fade for the bring-to-life hand-off (0 = invisible). */
  setOpacity(a: number): void {
    const t = a < 0.999;
    if (this.material.transparent !== t) {
      this.material.transparent = t;
      this.material.needsUpdate = true;
    }
    this.material.opacity = a;
    this.material.depthWrite = !t;
  }

  setCursor(i: number, visible: boolean, x = 0, y = 0, z = 0, r = 0.01, color = 0xffffff): void {
    const c = this.cursors[i];
    c.visible = visible;
    if (!visible) return;
    c.position.set(x, y, z);
    c.scale.setScalar(r);
    (c.material as MeshBasicMaterial).color.set(color);
  }

  setClayColor(hex: number): void {
    this.material.color = new Color(hex);
  }
}

/** Clay tints per piece (sRGB): terracotta, slate blue, olive, plum. */
export const PIECE_COLORS = ['#c98a5e', '#7f9cc0', '#a3b067', '#b07aa6'];
const PIECE_LINEAR = PIECE_COLORS.map((h) => new Color(h)); // Color() converts sRGB hex to linear

function pieceColors(labels: Uint8Array): Float32Array {
  const out = new Float32Array(labels.length * 3);
  for (let v = 0; v < labels.length; v++) {
    const c = PIECE_LINEAR[labels[v] % PIECE_LINEAR.length];
    out[v * 3] = c.r; out[v * 3 + 1] = c.g; out[v * 3 + 2] = c.b;
  }
  return out;
}

function radialTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // texture alpha drives the shadow; colour comes from the material (black)
  return new CanvasTexture(c);
}
