import { describe, expect, it } from 'vitest';
import { copySaved, fromSurfaceFrame, nextClayName, SavedCreation, toSurfaceFrame } from '../../src/storage/library';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('library poses relative to the table', () => {
  it('round-trips a pose through a rotated, moved table', () => {
    const table = { centerX: 0.4, centerZ: -0.9, topY: 0.74, yaw: 0.7 };
    const p: [number, number, number] = [0.55, 0.81, -0.62];
    const q: [number, number, number, number] = [0.1, 0.3, -0.05, Math.sqrt(1 - 0.01 - 0.09 - 0.0025)];
    const local = toSurfaceFrame(table, p, q);
    const back = fromSurfaceFrame(table, local.p, local.q);
    close(back.p, p);
    close(back.q, q);
    expect(local.p[1]).toBeCloseTo(0.07, 6); // height above the table top
  });

  it('a pinned spot follows the table when it is found somewhere else (same spot on the table)', () => {
    const t1 = { centerX: 0, centerZ: -0.42, topY: 0.72, yaw: 0 };
    const t2 = { centerX: 1.0, centerZ: -1.0, topY: 0.76, yaw: Math.PI / 2 };
    // 10 cm right of the centre, resting on the table
    const local = toSurfaceFrame(t1, [0.1, 0.75, -0.42], [0, 0, 0, 1]);
    const moved = fromSurfaceFrame(t2, local.p, local.q);
    expect(moved.p[1]).toBeCloseTo(0.79, 6);
    expect(Math.hypot(moved.p[0] - 1, moved.p[2] + 1)).toBeCloseTo(0.1, 6);
    // and it turned with the table
    expect(Math.abs(moved.q[1])).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('Library items', () => {
  it('default names count up from the highest "Clay N"', () => {
    expect(nextClayName([])).toBe('Clay 1');
    expect(nextClayName(['Clay 1', 'Cup', 'Clay 4'])).toBe('Clay 5');
    expect(nextClayName(['Clay one', 'My Clay 2'])).toBe('Clay 1');
  });

  it('a copy has its own id and name and never shares data with the original', () => {
    const s = {
      schemaVersion: 1, id: 'a', savedAt: 1, pinned: true, thumb: '', pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
      creation: { id: 'a', name: 'Cup', parts: [{ materialId: 'glass' }] }, parts: [],
    } as unknown as SavedCreation;
    const c = copySaved(s, 'b', 'Mug');
    expect([c.id, c.creation.id, c.creation.name]).toEqual(['b', 'b', 'Mug']);
    (c.creation.parts[0] as { materialId: string }).materialId = 'steel';
    expect((s.creation.parts[0] as { materialId: string }).materialId).toBe('glass');
    expect(s.creation.name).toBe('Cup');
  });
});
