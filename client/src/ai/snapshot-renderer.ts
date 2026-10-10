/**
 * Renders the clay sculpt offscreen from fixed angles (plain clay shading on a
 * light backdrop) to PNG data URLs for the vision model. Only these renders of
 * the player's own sculpt are ever sent; never camera images.
 * Works during an XR session: XR is paused on the renderer for the offscreen pass.
 */
import {
  Box3, BufferGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget,
} from '@iwsdk/core';

const VIEWS: [number, number][] = [
  [35, 22], // front three-quarter
  [125, 12], // side
  [215, 48], // from above, behind
];

export function renderViews(renderer: WebGLRenderer, geometries: BufferGeometry[], size = 320): string[] {
  const scene = new Scene();
  scene.background = new Color(0xf1ede6);
  scene.add(new HemisphereLight(0xffffff, 0xb8a898, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.4, 1, 0.6);
  scene.add(sun);
  const mat = new MeshStandardMaterial({ color: 0xc98a5e, roughness: 0.85 });
  const group = new Group();
  for (const g of geometries) group.add(new Mesh(g, mat));
  scene.add(group);
  const box = new Box3().setFromObject(group);
  const center = box.getCenter(new Vector3());
  const radius = Math.max(0.02, box.getSize(new Vector3()).length() / 2);
  const camera = new PerspectiveCamera(30, 1, 0.01, 10);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.1;

  const rt = new WebGLRenderTarget(size, size);
  rt.texture.colorSpace = SRGBColorSpace;
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  const prevTarget = renderer.getRenderTarget();
  const xrWas = renderer.xr.enabled;
  renderer.xr.enabled = false;
  const out: string[] = [];
  try {
    for (const [az, el] of VIEWS) {
      const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      camera.position.set(center.x + Math.sin(a) * Math.cos(e) * dist, center.y + Math.sin(e) * dist, center.z + Math.cos(a) * Math.cos(e) * dist);
      camera.lookAt(center);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
      // WebGL rows are bottom-up
      for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      ctx.putImageData(image, 0, 0);
      out.push(canvas.toDataURL('image/png'));
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = xrWas;
    rt.dispose();
    mat.dispose();
  }
  return out;
}
