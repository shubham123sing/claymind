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
let rt: WebGLRenderTarget | null = null;

export function renderThumbnail(renderer: WebGLRenderer, view: Object3D): string {
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
  camera.position.set(center.x + dist * 0.55, center.y + dist * 0.45, center.z + dist * 0.7);
  camera.lookAt(center);

  rt ??= new WebGLRenderTarget(SIZE, SIZE);
  rt.texture.colorSpace = SRGBColorSpace;
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
  return canvas.toDataURL('image/jpeg', 0.8);
}
