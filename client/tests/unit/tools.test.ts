import { describe, expect, it } from 'vitest';
import { createHandState, Vec3 } from '../../src/platform/input/hand-state';
import { AddTool, createHandToolState, ShapeTool, ToolContext } from '../../src/sculpt/tools';

function fakeCtx() {
  const strokes: { op: string; at: Vec3; r: number; delta?: Vec3 }[] = [];
  let actions = 0;
  const ctx: ToolContext = {
    clayCenter: [0, 0.8, -0.4],
    beginAction: () => actions++,
    nearClay: (p, m) => Math.hypot(p[0], p[1] - 0.8, p[2] + 0.4) < 0.06 + m,
    stroke: (op, at, r, delta) => strokes.push({ op, at: [...at] as Vec3, r, delta: delta ? ([...delta] as Vec3) : undefined }),
  };
  return { ctx, strokes, actions: () => actions };
}

describe('ShapeTool', () => {
  it('pinch on the clay then moving out produces drag strokes in one action', () => {
    const { ctx, strokes, actions } = fakeCtx();
    const h = createHandState('right');
    const s = createHandToolState();
    h.tracked = true;
    h.pinching = h.pinchStarted = true;
    h.pinchPoint = [0.06, 0.8, -0.4];
    ShapeTool.update(h, ctx, s);
    h.pinchStarted = false;
    for (let i = 1; i <= 5; i++) {
      h.pinchPoint = [0.06 + i * 0.005, 0.8, -0.4];
      ShapeTool.update(h, ctx, s);
    }
    expect(actions()).toBe(1);
    expect(strokes.length).toBe(5);
    expect(strokes.every((st) => st.op === 'drag' && st.delta![0] > 0)).toBe(true);
    h.pinching = false;
    ShapeTool.update(h, ctx, s);
    expect(s.mode).toBe('idle');
  });

  it('pinch started away from the clay does nothing', () => {
    const { ctx, strokes } = fakeCtx();
    const h = createHandState('right');
    const s = createHandToolState();
    h.tracked = h.pinching = h.pinchStarted = true;
    h.pinchPoint = [0.4, 0.8, -0.4];
    ShapeTool.update(h, ctx, s);
    h.pinchStarted = false;
    h.pinchPoint = [0.05, 0.8, -0.4]; // drifting into the clay must not start sculpting
    ShapeTool.update(h, ctx, s);
    expect(strokes.length).toBe(0);
  });

  it('pointing finger into the clay carves a dent; open palm facing the clay smooths', () => {
    const { ctx, strokes } = fakeCtx();
    const h = createHandState('right');
    const s = createHandToolState();
    h.tracked = h.pointing = true;
    h.indexTip = [0, 0.8, -0.35];
    ShapeTool.update(h, ctx, s);
    expect(strokes[0].op).toBe('carve');
    h.pointing = false;
    h.palmOpen = true;
    h.palmCenter = [0, 0.87, -0.4];
    h.palmNormal = [0, -1, 0]; // facing down onto the clay
    for (let i = 0; i < 4; i++) ShapeTool.update(h, ctx, s);
    expect(strokes.some((st) => st.op === 'smooth')).toBe(true);
    // palm facing up (wrist-menu pose) must not smooth
    const before = strokes.length;
    h.palmNormal = [0, 1, 0];
    for (let i = 0; i < 4; i++) ShapeTool.update(h, ctx, s);
    expect(strokes.length).toBe(before);
  });
});

describe('AddTool', () => {
  it('lays continuous capsule strokes along the pinch path', () => {
    const { ctx, strokes } = fakeCtx();
    const h = createHandState('right');
    const s = createHandToolState();
    h.tracked = h.pinching = true;
    for (let i = 0; i < 10; i++) {
      h.aimPoint = [0.06, 0.8 + i * 0.004, -0.4];
      AddTool.update(h, ctx, s);
    }
    expect(strokes[0].op).toBe('add');
    const segs = strokes.slice(1);
    expect(segs.length).toBeGreaterThan(4);
    // each segment starts where the previous one ended (no gaps)
    for (let i = 1; i < segs.length; i++) {
      const prevEnd = segs[i - 1].at[1] + segs[i - 1].delta![1];
      expect(segs[i].at[1]).toBeCloseTo(prevEnd, 6);
    }
  });
});
