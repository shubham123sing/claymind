/**
 * Sculpt tools. A tool turns one hand's state into brush strokes.
 * To add a tool: implement SculptTool and append it to TOOLS (the wrist menu
 * and the browser toolbar list whatever is registered here).
 *
 * Gestures common to every tool (handled by applyCommonGestures):
 *   open palm on the clay -> smooth
 */
import type { BrushOp } from './sdf-grid.js';
import type { HandState, Vec3 } from '../platform/input/hand-state.js';

export interface ToolContext {
  /** Queue a stroke at a world-space point with a world-space radius. */
  stroke(op: BrushOp, at: Vec3, radius: number, delta?: Vec3): void;
  /** Start a new undoable action (one continuous gesture). */
  beginAction(): void;
  /** True if a world point is within `margin` metres of the clay's bounding box. */
  nearClay(p: Vec3, margin: number): boolean;
  /** World-space centre of the clay (for "is the palm facing the clay"). */
  clayCenter: Vec3;
}

/** Per-hand scratch state a tool may keep between frames. */
export interface HandToolState {
  mode: 'idle' | 'pinch' | 'poke' | 'palm';
  last: Vec3;
  /** Last point a stamp was placed (stamp spacing). */
  lastStamp: Vec3;
  frame: number;
}

export function createHandToolState(): HandToolState {
  return { mode: 'idle', last: [0, 0, 0], lastStamp: [0, 0, 0], frame: 0 };
}

export interface SculptTool {
  id: string;
  label: string;
  /** Short glyph shown on buttons. */
  icon: string;
  color: number;
  /** Radius shown by the brush cursor (m). */
  cursorRadius: number;
  update(hand: HandState, ctx: ToolContext, s: HandToolState): void;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const copy = (dst: Vec3, src: Vec3) => {
  dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2];
};

/** Stamp `op` along a path with spacing; begins an action on first contact. */
function stamp(ctx: ToolContext, s: HandToolState, mode: HandToolState['mode'], op: BrushOp, at: Vec3, r: number): void {
  if (s.mode !== mode) {
    s.mode = mode;
    ctx.beginAction();
    ctx.stroke(op, at, r);
    copy(s.lastStamp, at);
    return;
  }
  s.frame++;
  if (op === 'smooth') {
    // smoothing keeps working while held still
    if (dist(at, s.lastStamp) >= r * 0.35 || s.frame % 3 === 0) {
      ctx.stroke(op, at, r);
      copy(s.lastStamp, at);
    }
    return;
  }
  // add/carve: sweep a capsule from the last point, so strokes are continuous
  if (dist(at, s.lastStamp) >= r * 0.25) {
    segment[0] = at[0] - s.lastStamp[0]; segment[1] = at[1] - s.lastStamp[1]; segment[2] = at[2] - s.lastStamp[2];
    ctx.stroke(op, s.lastStamp, r, segment);
    copy(s.lastStamp, at);
  }
}

const tmp: Vec3 = [0, 0, 0];
const segment: Vec3 = [0, 0, 0];

/** Open palm pressed against the clay smooths it. Returns true if it acted. */
function applyCommonGestures(h: HandState, ctx: ToolContext, s: HandToolState): boolean {
  if (!h.palmOpen || !ctx.nearClay(h.palmCenter, 0.015)) {
    if (s.mode === 'palm') s.mode = 'idle';
    return false;
  }
  // palm must face the clay, otherwise an upturned palm (wrist menu) would smooth
  const tx = ctx.clayCenter[0] - h.palmCenter[0], ty = ctx.clayCenter[1] - h.palmCenter[1], tz = ctx.clayCenter[2] - h.palmCenter[2];
  const len = Math.hypot(tx, ty, tz) || 1;
  if ((tx * h.palmNormal[0] + ty * h.palmNormal[1] + tz * h.palmNormal[2]) / len < 0.3) return false;
  tmp[0] = h.palmCenter[0] + h.palmNormal[0] * 0.01;
  tmp[1] = h.palmCenter[1] + h.palmNormal[1] * 0.01;
  tmp[2] = h.palmCenter[2] + h.palmNormal[2] * 0.01;
  s.frame++;
  if (s.mode !== 'palm') {
    s.mode = 'palm';
    ctx.beginAction();
  }
  if (s.frame % 2 === 0) ctx.stroke('smooth', tmp, 0.03);
  return true;
}

function endIfReleased(h: HandState, s: HandToolState): void {
  if ((s.mode === 'pinch' && !h.pinching) || (s.mode === 'poke' && !h.pointing)) s.mode = 'idle';
}

const delta: Vec3 = [0, 0, 0];

/** Shape: poke to dent, pinch-and-drag to pull clay out, palm to smooth. */
export const ShapeTool: SculptTool = {
  id: 'shape', label: 'Shape', icon: '✋', color: 0xe2733b, cursorRadius: 0.009,
  update(h, ctx, s) {
    endIfReleased(h, s);
    if (applyCommonGestures(h, ctx, s)) return;
    if (h.pinchStarted && ctx.nearClay(h.pinchPoint, 0.015)) {
      s.mode = 'pinch';
      ctx.beginAction();
      copy(s.last, h.pinchPoint);
      return;
    }
    if (s.mode === 'pinch') {
      delta[0] = h.pinchPoint[0] - s.last[0]; delta[1] = h.pinchPoint[1] - s.last[1]; delta[2] = h.pinchPoint[2] - s.last[2];
      if (Math.hypot(delta[0], delta[1], delta[2]) > 0.0015) {
        ctx.stroke('drag', s.last, 0.02, delta);
        copy(s.last, h.pinchPoint);
      }
      return;
    }
    if (h.pointing && ctx.nearClay(h.indexTip, 0.01)) stamp(ctx, s, 'poke', 'carve', h.indexTip, 0.009);
  },
};

/** Add: pinch to lay down clay. */
export const AddTool: SculptTool = {
  id: 'add', label: 'Add', icon: '+', color: 0x5fbf72, cursorRadius: 0.011,
  update(h, ctx, s) {
    endIfReleased(h, s);
    if (applyCommonGestures(h, ctx, s)) return;
    if (h.pinching && (s.mode === 'pinch' || ctx.nearClay(h.aimPoint, 0.03))) stamp(ctx, s, 'pinch', 'add', h.aimPoint, 0.011);
  },
};

/** Carve: poke or pinch to remove clay. */
export const CarveTool: SculptTool = {
  id: 'carve', label: 'Carve', icon: '−', color: 0xd9534f, cursorRadius: 0.012,
  update(h, ctx, s) {
    endIfReleased(h, s);
    if (applyCommonGestures(h, ctx, s)) return;
    if (h.pinching && (s.mode === 'pinch' || ctx.nearClay(h.aimPoint, 0.01))) stamp(ctx, s, 'pinch', 'carve', h.aimPoint, 0.012);
    else if (h.pointing && ctx.nearClay(h.indexTip, 0.01)) stamp(ctx, s, 'poke', 'carve', h.indexTip, 0.011);
  },
};

/** Smooth: pinch or poke to soften. */
export const SmoothTool: SculptTool = {
  id: 'smooth', label: 'Smooth', icon: '~', color: 0x5aa9e6, cursorRadius: 0.022,
  update(h, ctx, s) {
    endIfReleased(h, s);
    if (applyCommonGestures(h, ctx, s)) return;
    if (h.pinching && (s.mode === 'pinch' || ctx.nearClay(h.aimPoint, 0.02))) stamp(ctx, s, 'pinch', 'smooth', h.aimPoint, 0.022);
    else if (h.pointing && ctx.nearClay(h.indexTip, 0.01)) stamp(ctx, s, 'poke', 'smooth', h.indexTip, 0.016);
  },
};

/** Paint brush: the colour comes from the colour picker; size 3 mm - 3 cm (radius). */
export const brush = { size: 0.008, min: 0.003, max: 0.03 };

/** Paint: touch the clay with a fingertip (or pinch) and draw on it. The shape never changes. */
export const PaintTool: SculptTool = {
  id: 'paint', label: 'Paint', icon: '✎', color: 0xb07aa6, cursorRadius: brush.size,
  update(h, ctx, s) {
    this.cursorRadius = brush.size;
    endIfReleased(h, s);
    if (h.pinching && (s.mode === 'pinch' || ctx.nearClay(h.aimPoint, 0.01))) stamp(ctx, s, 'pinch', 'paint', h.aimPoint, brush.size);
    else if (h.pointing && ctx.nearClay(h.indexTip, 0.006)) stamp(ctx, s, 'poke', 'paint', h.indexTip, brush.size);
  },
};

/** Eraser: like Paint, but brings back the piece colour. */
export const EraserTool: SculptTool = {
  id: 'erase', label: 'Eraser', icon: '⌫', color: 0x8fa3b8, cursorRadius: brush.size,
  update(h, ctx, s) {
    this.cursorRadius = brush.size;
    endIfReleased(h, s);
    if (h.pinching && (s.mode === 'pinch' || ctx.nearClay(h.aimPoint, 0.01))) stamp(ctx, s, 'pinch', 'erase', h.aimPoint, brush.size);
    else if (h.pointing && ctx.nearClay(h.indexTip, 0.006)) stamp(ctx, s, 'poke', 'erase', h.indexTip, brush.size);
  },
};

export const TOOLS: SculptTool[] = [ShapeTool, AddTool, CarveTool, SmoothTool, PaintTool, EraserTool];
