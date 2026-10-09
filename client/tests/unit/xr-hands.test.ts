import { describe, expect, it } from 'vitest';
import { createHandState, HandState } from '../../src/platform/input/hand-state';
import { XrHandsProvider } from '../../src/platform/input/xr-hands-provider';

type P = [number, number, number];

/** Build a fake right/left hand: wrist at origin + offset, palm facing down, fingers toward -z. */
function handJoints(side: 'left' | 'right', o: P, opts: { pinch?: boolean; point?: boolean; open?: boolean }) {
  const sx = side === 'right' ? 1 : -1; // thumb on the inside
  const j: Record<string, P> = {
    wrist: [0, 0, 0],
    'index-finger-metacarpal': [-0.02 * sx, 0, -0.03],
    'pinky-finger-metacarpal': [0.03 * sx, 0, -0.025],
    'middle-finger-phalanx-proximal': [0, 0, -0.09],
  };
  const ext = (x: number): P => [x * sx, 0, -0.18];
  const curl = (x: number): P => [x * sx, -0.03, -0.08];
  j['index-finger-tip'] = opts.pinch ? [-0.03 * sx, -0.02, -0.11] : opts.point || opts.open ? ext(-0.02) : curl(-0.02);
  j['middle-finger-tip'] = opts.open ? ext(0) : curl(0);
  j['ring-finger-tip'] = opts.open ? ext(0.015) : curl(0.015);
  j['pinky-finger-tip'] = opts.open ? ext(0.03) : curl(0.03);
  j['thumb-tip'] = opts.pinch ? [-0.03 * sx, -0.02, -0.105] : [-0.06 * sx, 0, -0.07];
  for (const k of Object.keys(j)) j[k] = [j[k][0] + o[0], j[k][1] + o[1], j[k][2] + o[2]];
  return j;
}

function fakeWorld(sources: () => { side: 'left' | 'right'; joints: Record<string, P> }[]) {
  const frame = {
    getJointPose: (space: { name: string; owner: Record<string, P> }) => {
      const p = space.owner[space.name];
      return p ? { transform: { position: { x: p[0], y: p[1], z: p[2] } } } : null;
    },
  };
  const session = {
    get inputSources() {
      return sources().map((s) => ({
        handedness: s.side,
        hand: { get: (name: string) => ({ name, owner: s.joints }) },
      }));
    },
  };
  return { session, renderer: { xr: { getFrame: () => frame, getReferenceSpace: () => ({}) } } } as never;
}

function run(provider: XrHandsProvider, hands: Record<'left' | 'right', HandState>, frames = 1) {
  for (let i = 0; i < frames; i++) provider.update(hands, 1 / 72);
}

describe('XrHandsProvider', () => {
  it('detects pinch start/end with a midpoint between thumb and index', () => {
    let pinch = false;
    const p = new XrHandsProvider(fakeWorld(() => [{ side: 'right', joints: handJoints('right', [0, 1, 0], { pinch }) }]));
    const hands = { left: createHandState('left'), right: createHandState('right') };
    run(p, hands, 3);
    expect(hands.right.tracked).toBe(true);
    expect(hands.right.pinching).toBe(false);
    pinch = true;
    run(p, hands);
    expect(hands.right.pinchStarted).toBe(true);
    expect(hands.right.pinching).toBe(true);
    expect(hands.right.pinchPoint[1]).toBeCloseTo(0.98, 1);
    pinch = false;
    run(p, hands);
    expect(hands.right.pinchEnded).toBe(true);
  });

  it('classifies pointing and open palm, palm normal points down for both hands', () => {
    let mode: 'point' | 'open' = 'point';
    const p = new XrHandsProvider(
      fakeWorld(() => [
        { side: 'right', joints: handJoints('right', [0.2, 1, 0], { [mode]: true }) },
        { side: 'left', joints: handJoints('left', [-0.2, 1, 0], { [mode]: true }) },
      ]),
    );
    const hands = { left: createHandState('left'), right: createHandState('right') };
    run(p, hands, 2);
    expect(hands.right.pointing).toBe(true);
    expect(hands.right.palmOpen).toBe(false);
    mode = 'open';
    run(p, hands);
    for (const h of [hands.left, hands.right]) {
      expect(h.palmOpen).toBe(true);
      expect(h.pointing).toBe(false);
      expect(h.palmNormal[1]).toBeLessThan(-0.9);
    }
  });

  it('marks hands untracked and ends a pinch after tracking loss', () => {
    let present = true;
    const p = new XrHandsProvider(
      fakeWorld(() => (present ? [{ side: 'right', joints: handJoints('right', [0, 1, 0], { pinch: true }) }] : [])),
    );
    const hands = { left: createHandState('left'), right: createHandState('right') };
    run(p, hands, 2);
    expect(hands.right.pinching).toBe(true);
    present = false;
    run(p, hands, 3);
    expect(hands.right.tracked).toBe(false);
    expect(hands.right.pinching).toBe(true); // short loss is tolerated
    run(p, hands, 6);
    expect(hands.right.pinching).toBe(false);
  });
});
