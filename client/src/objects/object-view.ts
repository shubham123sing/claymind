/**
 * Visual helpers for creations: PBR material from the material table, info
 * label sprite, blob shadow, and the convex-hull volume used to correct mass
 * (Havok derives mass from the hull; we want density × true volume).
 */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from '@iwsdk/core';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { Material } from '../materials/materials.js';
import type { BakedMesh } from './bake.js';

const materialCache = new Map<string, MeshStandardMaterial>();

export function pbrMaterial(m: Material): MeshStandardMaterial {
  let mat = materialCache.get(m.id);
  if (!mat) {
    mat = new MeshStandardMaterial({
      color: m.visual.color,
      roughness: m.visual.roughness,
      metalness: m.visual.metalness,
      transparent: m.visual.opacity < 1,
      opacity: m.visual.opacity,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    materialCache.set(m.id, mat);
  }
  return mat;
}

export function geometryFrom(b: BakedMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new BufferAttribute(b.normals, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Volume of the convex hull of (a subsample of) the vertices, m^3. */
export function hullVolume(positions: Float32Array): number {
  const n = positions.length / 3;
  const stride = Math.max(1, Math.floor(n / 1500));
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i += stride) pts.push(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  if (pts.length < 4) return 0;
  const hull = new ConvexHull().setFromPoints(pts);
  let v = 0;
  for (const face of hull.faces) {
    // fan-triangulate the face loop and sum signed tetrahedra against the origin
    const e0 = face.edge;
    const a = e0.head().point;
    let e = e0.next;
    while (e.next !== e0) {
      const b = e.head().point, c = e.next.head().point;
      v += a.dot(b.clone().cross(c)) / 6;
      e = e.next;
    }
  }
  return Math.abs(v);
}

export function makeShadow(tex: CanvasTexture): Mesh {
  const m = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.5 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

export function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Two-line info label (title / details), ~2.5 cm text at arm's length. */
export class InfoLabel {
  readonly sprite: Sprite;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private text = '';

  constructor() {
    this.canvas.width = 640;
    this.canvas.height = 176;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(new SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false }));
    this.sprite.scale.set(0.16, 0.044, 1);
    this.sprite.renderOrder = 30;
  }

  set(title: string, detail: string, accent: string): void {
    const key = `${title}|${detail}|${accent}`;
    if (key === this.text) return;
    this.text = key;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 640, 176);
    ctx.fillStyle = 'rgba(16,18,22,0.78)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 624, 160, 40);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(52, 62, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f1ec';
    ctx.textBaseline = 'middle';
    ctx.font = '600 50px system-ui, sans-serif';
    ctx.fillText(title, 82, 62, 530);
    ctx.fillStyle = 'rgba(244,241,236,0.75)';
    ctx.font = '500 34px system-ui, sans-serif';
    ctx.fillText(detail, 40, 126, 560);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
  }
}
