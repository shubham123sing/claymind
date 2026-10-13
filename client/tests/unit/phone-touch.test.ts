import { describe, expect, it, vi } from 'vitest';

vi.mock('@iwsdk/core', async () => await import('three'));

const { PerspectiveCamera, Sphere, Vector3 } = await import('three');
const { PointerProvider } = await import('../../src/platform/input/pointer-provider');
const { createHandState } = await import('../../src/platform/input/hand-state');

/** Phone AR: screen touches come in as XR rays, not DOM events (Update 1, Step 0). */
describe('phone AR touch', () => {
  const clay = new Sphere(new Vector3(0, 0.8, -0.4), 0.05);
  const canvas = { addEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
  vi.stubGlobal('addEventListener', () => {});
  const make = () => {
    const camera = new PerspectiveCamera();
    camera.updateMatrixWorld();
    const p = new PointerProvider(canvas as never, camera, (ray) => ray.ray.intersectSphere(clay, new Vector3()), () => true);
    const hands = { left: createHandState('left'), right: createHandState('right') };
    return { p, hands };
  };
  const eye = new Vector3(0, 1.2, 0);
  const toward = (x: number, y: number, z: number) => new Vector3(x, y, z).sub(eye).normalize();

  it('is off in XR until the screen is touched (Quest hands are untouched)', () => {
    const { p } = make();
    expect(p.active()).toBe(false);
  });

  it('a touch on the clay pinches it, follows the finger, and releases', () => {
    const { p, hands } = make();
    p.touchStart(eye, toward(0, 0.8, -0.4));
    expect(p.active()).toBe(true);
    p.update(hands, 1 / 30);
    expect(hands.right.pinchStarted).toBe(true);
    expect(hands.right.tracked).toBe(true);
    expect(hands.right.aimPoint[1]).toBeGreaterThan(0.75);
    p.touchMove(eye, toward(0.01, 0.8, -0.4));
    p.update(hands, 1 / 30);
    expect(hands.right.pinching).toBe(true);
    p.touchEnd();
    p.update(hands, 1 / 30);
    expect(hands.right.pinchEnded).toBe(true);
    expect(hands.right.pinching).toBe(false);
    p.update(hands, 1 / 30);
    expect(hands.right.tracked).toBe(false); // no hover between touches
  });

  it('a swipe beside the clay turns it instead', () => {
    const { p, hands } = make();
    p.touchStart(eye, toward(-0.3, 0.8, -0.4));
    p.touchMove(eye, toward(-0.2, 0.8, -0.4));
    p.update(hands, 1 / 30);
    expect(hands.right.pinching).toBe(false);
    expect(p.orbitDx).toBeGreaterThan(10);
    p.touchEnd();
  });
});
