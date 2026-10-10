import { expect, it } from 'vitest';
import { SdfGrid } from '../../src/sculpt/sdf-grid';

it('carve removes the clay inside the brush and leaves clay outside it', () => {
  const g = new SdfGrid(48, 0.25);
  g.fillSphere(0, 0, 0, 0.05);
  g.brush('carve', 0.05, 0, 0, 0.02);
  expect(g.sample(0.04, 0, 0)).toBeGreaterThan(0); // inside the brush: gone
  expect(g.sample(0, 0, 0)).toBeLessThan(0); // the centre of the lump: untouched
  expect(g.sample(-0.04, 0, 0)).toBeLessThan(0);
  g.brush('carve', 0, 0, 0, 0.1); // a brush bigger than the lump removes all of it
  expect(g.sample(0, 0, 0)).toBeGreaterThan(0);
  expect(g.sample(0.03, 0.02, 0)).toBeGreaterThan(0);
});
