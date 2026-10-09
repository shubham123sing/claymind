import { describe, expect, it } from 'vitest';
import { ChunkMesher, meshVolume } from '../../src/sculpt/marching-cubes';
import { SdfGrid } from '../../src/sculpt/sdf-grid';

function totalVolume(mesher: ChunkMesher): { volume: number; tris: number } {
  let volume = 0, tris = 0;
  for (const c of mesher.meshDirty()) {
    volume += meshVolume(c.positions);
    tris += c.positions.length / 9;
  }
  return { volume, tris };
}

describe('SDF grid + marching cubes', () => {
  it('meshes a sphere with correct volume and outward (CCW) winding', () => {
    const g = new SdfGrid(48, 0.25);
    const r = 0.06;
    g.fillSphere(0, 0, 0, r);
    const { volume, tris } = totalVolume(new ChunkMesher(g));
    const expected = (4 / 3) * Math.PI * r ** 3;
    expect(volume).toBeGreaterThan(0); // positive => outward winding
    expect(Math.abs(volume - expected) / expected).toBeLessThan(0.03);
    expect(tris).toBeGreaterThan(1000);
  });

  it('only marks chunks near a brush as dirty', () => {
    const g = new SdfGrid(48, 0.25);
    g.fillSphere(0, 0, 0, 0.06);
    new ChunkMesher(g).meshDirty();
    expect(g.dirty.reduce((a, b) => a + b, 0)).toBe(0);
    g.brush('add', 0.06, 0, 0, 0.01);
    const dirty = g.dirty.reduce((a, b) => a + b, 0);
    expect(dirty).toBeGreaterThan(0);
    expect(dirty).toBeLessThanOrEqual(27);
  });

  it('add increases volume, carve decreases it', () => {
    const g = new SdfGrid(48, 0.25);
    g.fillSphere(0, 0, 0, 0.06);
    const m = new ChunkMesher(g);
    const base = totalVolume(m).volume;
    g.brush('add', 0.06, 0, 0, 0.02);
    g.markAllDirty();
    const added = totalVolume(m).volume;
    g.brush('carve', -0.06, 0, 0, 0.03);
    g.markAllDirty();
    const carved = totalVolume(m).volume;
    expect(added).toBeGreaterThan(base);
    expect(carved).toBeLessThan(added);
  });
});
