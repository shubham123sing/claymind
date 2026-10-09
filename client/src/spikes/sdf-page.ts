/**
 * Spike 4: SDF sculpt frame-time benchmark. Open /spikes/sdf.html on desktop
 * and in Quest Browser. Drag on the clay: add; Shift+drag: carve; Alt+drag: smooth.
 */
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, Group, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer,
} from '@iwsdk/core';
import type { BrushOp } from '../sculpt/sdf-grid.js';
import type { SculptRequest, SculptResponse } from '../sculpt/sdf-worker.js';

const params = new URLSearchParams(location.search);
const res = Number(params.get('res') ?? 48);
const SIZE = 0.25;

const hud = document.getElementById('hud')!;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x1d1f24);
const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 10);
camera.position.set(0, 0.12, 0.45);
camera.lookAt(0, 0, 0);
scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.6);
sun.position.set(0.3, 0.6, 0.4);
scene.add(sun);

const clayMat = new MeshStandardMaterial({ color: 0xc98a5e, roughness: 0.85 });
const clay = new Group();
scene.add(clay);
const chunkMeshes = new Map<number, Mesh>();

const worker = new Worker(new URL('../sculpt/sdf-worker.ts', import.meta.url), { type: 'module' });

// --- stats ---
const stats = { brush: [] as number[], mesh: [] as number[], rtt: [] as number[], chunks: [] as number[], upload: [] as number[] };
let frameMs = 0, maxFrameMs = 0, initMs = 0, triangles = 0;
const sent = new Map<number, number>();
let nextId = 1;
let inFlight = false;
let pending: { op: BrushOp; x: number; y: number; z: number; r: number }[] = [];

function pct(a: number[], p: number): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function flush(): void {
  if (inFlight || pending.length === 0) return;
  const id = nextId++;
  sent.set(id, performance.now());
  inFlight = true;
  const msg: SculptRequest = { type: 'strokes', id, strokes: pending };
  pending = [];
  worker.postMessage(msg);
}

worker.onmessage = (e: MessageEvent<SculptResponse>) => {
  const m = e.data;
  const t0 = performance.now();
  for (const c of m.chunks) {
    let mesh = chunkMeshes.get(c.chunk);
    if (c.positions.length === 0) {
      if (mesh) { clay.remove(mesh); mesh.geometry.dispose(); chunkMeshes.delete(c.chunk); }
      continue;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(c.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(c.normals, 3));
    geo.computeBoundingSphere();
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
    else { mesh = new Mesh(geo, clayMat); chunkMeshes.set(c.chunk, mesh); clay.add(mesh); }
  }
  const uploadMs = performance.now() - t0;
  triangles = 0;
  for (const mesh of chunkMeshes.values()) triangles += (mesh.geometry.getAttribute('position').count / 3) | 0;
  if (m.id === 0) {
    initMs = m.brushMs + m.meshMs;
  } else {
    stats.brush.push(m.brushMs); stats.mesh.push(m.meshMs); stats.chunks.push(m.chunks.length); stats.upload.push(uploadMs);
    stats.rtt.push(performance.now() - (sent.get(m.id) ?? performance.now()));
    sent.delete(m.id);
  }
  inFlight = false;
  flush();
};

function init(): void {
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k].length = 0;
  const msg: SculptRequest = { type: 'init', res, size: SIZE, radius: 0.06 };
  worker.postMessage(msg);
}
init();

// --- mouse sculpting ---
const ray = new Raycaster();
const ndc = new Vector2();
let dragging = false;
let dragOp: BrushOp = 'add';
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragOp = e.shiftKey ? 'carve' : e.altKey ? 'smooth' : 'add';
  stroke(e);
});
addEventListener('pointerup', () => (dragging = false));
renderer.domElement.addEventListener('pointermove', (e) => dragging && stroke(e));
function stroke(e: PointerEvent): void {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(clay.children, false)[0];
  if (!hit) return;
  pending.push({ op: dragOp, x: hit.point.x, y: hit.point.y, z: hit.point.z, r: 0.012 });
  flush();
}

// --- scripted benchmark: brush orbits the lump like a hand would ---
let benchLeft = 0, benchT = 0;
document.getElementById('bench')!.onclick = () => {
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k].length = 0;
  maxFrameMs = 0;
  benchLeft = 400;
};
document.getElementById('res48')!.onclick = () => (location.search = '?res=48');
document.getElementById('res64')!.onclick = () => (location.search = '?res=64');
document.getElementById('reset')!.onclick = () => init();

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = now - last;
  last = now;
  frameMs = frameMs * 0.9 + dt * 0.1;
  if (benchLeft > 0) maxFrameMs = Math.max(maxFrameMs, dt);
  if (benchLeft > 0) {
    // one stroke per frame (≈ a fingertip moving at 72 Hz)
    benchT += 0.05;
    const ops: BrushOp[] = ['add', 'add', 'carve', 'smooth'];
    const op = ops[Math.floor(benchT / 3) % 4];
    const r = 0.065;
    pending.push({ op, x: Math.cos(benchT) * r, y: Math.sin(benchT * 0.7) * 0.04, z: Math.sin(benchT) * r, r: 0.014 });
    benchLeft--;
    flush();
  }
  clay.rotation.y += 0.002;
  renderer.render(scene, camera);
  hud.textContent =
    `SDF ${res}³  (voxel ${((SIZE / (res - 1)) * 1000).toFixed(1)} mm)  init ${initMs.toFixed(1)} ms\n` +
    `frame ${frameMs.toFixed(1)} ms  (max during bench ${maxFrameMs.toFixed(1)} ms)\n` +
    `tris ${triangles}  draw calls ${renderer.info.render.calls}  chunks ${chunkMeshes.size}\n` +
    `strokes ${stats.brush.length}${benchLeft > 0 ? `  (bench: ${benchLeft} left)` : ''}\n` +
    `worker brush  p50 ${pct(stats.brush, 0.5).toFixed(2)}  p95 ${pct(stats.brush, 0.95).toFixed(2)} ms\n` +
    `worker mesh   p50 ${pct(stats.mesh, 0.5).toFixed(2)}  p95 ${pct(stats.mesh, 0.95).toFixed(2)} ms  (${pct(stats.chunks, 0.5)} chunks)\n` +
    `main upload   p50 ${pct(stats.upload, 0.5).toFixed(2)}  p95 ${pct(stats.upload, 0.95).toFixed(2)} ms\n` +
    `round trip    p50 ${pct(stats.rtt, 0.5).toFixed(1)}  p95 ${pct(stats.rtt, 0.95).toFixed(1)} ms\n` +
    `drag: add · shift: carve · alt: smooth`;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
