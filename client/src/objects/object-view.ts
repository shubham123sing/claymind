/**
 * Visual helpers for creations: PBR material from the material table, info
 * label sprite, blob shadow, and the convex-hull volume used to correct mass
 * (Havok derives mass from the hull; we want density × true volume).
 */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from '@iwsdk/core';
import type { Material } from '../materials/materials.js';
import type { BakedMesh } from './bake.js';
import { envFor } from './env-map.js';

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
  // reflections become available after the renderer exists (env-map.ts)
  const env = envFor(m.visual.metalness, m.visual.roughness);
  if (mat.envMap !== env.map) {
    mat.envMap = env.map;
    mat.envMapIntensity = env.intensity;
    mat.needsUpdate = true;
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

/** Volume of the convex hull (moved to physics/body-build.ts, shared with the headless sim). */
export { hullVolume } from '../physics/body-build.js';

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
    this.sprite.renderOrder = 20; // over the objects, under the floating cards and panels (21+)
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
