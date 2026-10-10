/**
 * Bakes the offline "AI result" samples: one GLB per template, coloured by its
 * most likely material. Shipped with the game (public/samples) and the server's
 * mock image-to-3D provider (server/samples), so the AI path works with no
 * network and no keys. Run: npx vite-node scripts/make-samples.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { bakeFromSdf } from '../src/objects/bake';
import { compile } from '../src/objects/csg';
import { sdfBounds } from '../src/objects/descriptor';
import { weld, writeGlb } from '../src/objects/glb';
import { TEMPLATES } from '../src/objects/templates';
import { getMaterial } from '../src/materials/materials';

const outDirs = ['public/samples', '../server/samples'];
for (const d of outDirs) mkdirSync(d, { recursive: true });

for (const t of TEMPLATES) {
  const sdf = compile(t.sdf);
  const b = sdfBounds(sdf);
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const centred = (x: number, y: number, z: number) => sdf(x + c[0], y + c[1], z + c[2]);
  const baked = bakeFromSdf(centred, extent, { res: 52, pieces: 0 });
  const w = weld(baked.mesh.positions, baked.mesh.normals);
  const topMaterial = Object.entries(t.materialPriors).sort((a, z) => z[1] - a[1])[0][0];
  const m = getMaterial(topMaterial);
  const hex = parseInt(m.visual.color.slice(1), 16);
  // glTF base colour is linear; the material table stores sRGB hex
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  const glb = writeGlb({
    ...w,
    color: [lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255), m.visual.opacity],
    roughness: m.visual.roughness,
    metalness: m.visual.metalness,
    name: t.name,
  });
  for (const d of outDirs) writeFileSync(`${d}/${t.id}.glb`, Buffer.from(glb));
  console.log(`${t.id.padEnd(7)} ${(w.indices.length / 3).toFixed(0).padStart(6)} tris  ${(glb.byteLength / 1024).toFixed(0)} KB  ${topMaterial}`);
}
