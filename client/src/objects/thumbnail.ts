/**
 * Small Library thumbnail of an object's look (its piece meshes with their
 * colours and materials), rendered offscreen. Works during an XR session (XR is
 * paused on the renderer for the pass). Returns a JPEG data URL.
 */
import {
  Box3, Color, DirectionalLight, Group, HemisphereLight, Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
  WebGLRenderTarget,
} from '@iwsdk/core';

const SIZE = 128;
const targets = new Map<number, WebGLRenderTarget>();

export function renderThumbnail(renderer: WebGLRenderer, view: Object3D): string {
  return render(renderer, view, SIZE, [0.55, 0.45, 0.7]) as string;
}

/**
 * The picture for the optional vision check: a three-quarter view and one from above, side by side
 * in ONE image (a vision model counts about the same tokens per image whatever its size).
 */
export function renderViews(renderer: WebGLRenderer, view: Object3D, size = 224): string {
  const sheet = document.createElement('canvas');
  sheet.width = size * 2;
  sheet.height = size;
  const ctx = sheet.getContext('2d')!;
  ctx.drawImage(render(renderer, view, size, [0.55, 0.45, 0.7], false) as HTMLCanvasElement, 0, 0);
  ctx.drawImage(render(renderer, view, size, [0.05, 1, 0.12], false) as HTMLCanvasElement, size, 0);
  return sheet.toDataURL('image/jpeg', 0.85);
}

function render(renderer: WebGLRenderer, view: Object3D, SIZE: number, dir: [number, number, number], url = true): string | HTMLCanvasElement {
  const scene = new Scene();
  scene.background = new Color(0x2a2d33);
  scene.add(new HemisphereLight(0xffffff, 0x8a7a6a, 1.4));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.5, 1, 0.8);
  scene.add(sun);
  // a copy of the pieces in object-local space (shares geometry and materials)
  const g = new Group();
  for (const child of view.children) g.add(child.clone());
  scene.add(g);
  const box = new Box3().setFromObject(g);
  const center = box.getCenter(new Vector3());
  const radius = Math.max(0.02, box.getSize(new Vector3()).length() / 2);
  const camera = new PerspectiveCamera(30, 1, 0.005, 10);
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
  const d = new Vector3(...dir).normalize().multiplyScalar(dist * Math.hypot(0.55, 0.45, 0.7));
  camera.position.copy(center).add(d);
  camera.lookAt(center);

  let rt = targets.get(SIZE);
  if (!rt) {
    rt = new WebGLRenderTarget(SIZE, SIZE);
    rt.texture.colorSpace = SRGBColorSpace;
    targets.set(SIZE, rt);
  }
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const prev = renderer.getRenderTarget(), xrWas = renderer.xr.enabled;
  renderer.xr.enabled = false;
  try {
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, pixels);
  } finally {
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xrWas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) image.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
  ctx.putImageData(image, 0, 0);
  return url ? canvas.toDataURL('image/jpeg', 0.8) : canvas;
}
