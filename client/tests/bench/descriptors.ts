/** Print template descriptors (template res vs sculpt res). npx vite-node tests/bench/descriptors.ts */
import { compile, Sdf } from '../../src/objects/csg';
import { describe as describeShape, rasterize, sdfBounds } from '../../src/objects/descriptor';
import { TEMPLATES } from '../../src/objects/templates';
const fmt = (d: any) => `asp ${d.aspect.toFixed(2)} el ${d.elong.toFixed(2)} fill ${d.fill.toFixed(2)} open ${d.openTop.toFixed(2)} holes ${d.holes} prof ${d.profile.map((p: number) => p.toFixed(2)).join(',')} ext ${d.extents.map((e: number) => (e * 100).toFixed(1)).join('x')}`;
for (const t of TEMPLATES) {
  const sdf: Sdf = compile(t.sdf);
  const b = sdfBounds(sdf);
  const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const edge = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1.3;
  const a = describeShape(rasterize(sdf, 40, edge, c))!;
  const s = describeShape(rasterize(sdf, 48, 0.25, [0, c[1], 0]))!;
  console.log(t.id.padEnd(7), 'T', fmt(a));
  console.log(''.padEnd(7), 'S', fmt(s));
}
