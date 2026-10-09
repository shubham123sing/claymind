import { describe, expect, it, vi } from 'vitest';

// surface-system imports @iwsdk/core (three + DOM-free classes); stub the heavy runtime bits we don't use
vi.mock('@iwsdk/core', async () => {
  const three = await import('three');
  return { ...three, createSystem: () => class {}, PhysicsBody: {}, PhysicsShape: {}, PhysicsShapeType: {}, PhysicsState: {}, VisibilityState: {}, XRPlane: {} };
});

const { distanceToRect, nearestSurfacePoint, surface } = await import('../../src/platform/surface/surface-system');

describe('surface geometry', () => {
  it('distanceToRect is 0 above the table and grows outside, respecting yaw', () => {
    const c = { topY: 0.7, centerX: 1, centerZ: 0, halfW: 0.5, halfD: 0.25, yaw: Math.PI / 2 };
    // rotated 90°: the long side now runs along world Z
    expect(distanceToRect(c, 1, 0.45)).toBe(0);
    expect(distanceToRect(c, 1.4, 0)).toBeCloseTo(0.15, 5);
    expect(distanceToRect(c, 1, 0.8)).toBeCloseTo(0.3, 5);
    // asymmetric: a 45° table distinguishes +yaw from -yaw
    const d = { topY: 0.7, centerX: 0, centerZ: 0, halfW: 1, halfD: 0.05, yaw: Math.PI / 4 };
    // local +X maps to world (cos, -sin) = (0.707, -0.707): that point is on the table
    expect(distanceToRect(d, 0.6, -0.6)).toBe(0);
    expect(distanceToRect(d, 0.6, 0.6)).toBeGreaterThan(0.5);
  });

  it('nearestSurfacePoint clamps toward the user, inside the margin, with yaw', () => {
    Object.assign(surface, { centerX: 0, centerZ: -1, halfW: 0.6, halfD: 0.3, yaw: 0 });
    const out = [0, 0];
    nearestSurfacePoint(0, 0, 0.1, out); // user in front (+z)
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(-0.8, 5);
    Object.assign(surface, { yaw: Math.PI / 2 }); // long side now along z
    nearestSurfacePoint(0, 0, 0.1, out);
    expect(out[1]).toBeCloseTo(-0.5, 5);
  });
});
