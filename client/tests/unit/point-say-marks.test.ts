import { describe, expect, it } from 'vitest';
import { fitZone, simplifyPath } from '../../src/game-agent/marks';

const circle = (cx: number, cz: number, r: number, n = 24): [number, number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, 0, cz + Math.sin((i / n) * Math.PI * 2) * r]);

describe('Point + Say marks on the table', () => {
  it('a drawn loop becomes a zone with its centre and size; an open stroke does not', () => {
    const z = fitZone(circle(0.1, -0.05, 0.06))!;
    expect(z.center[0]).toBeCloseTo(0.1, 2);
    expect(z.center[2]).toBeCloseTo(-0.05, 2);
    expect(z.radius).toBeCloseTo(0.06, 2);
    const line: [number, number, number][] = Array.from({ length: 20 }, (_, i) => [i * 0.01, 0, 0]);
    expect(fitZone(line)).toBeNull();
  });
  it('a long path keeps at most 12 points, first and last included', () => {
    const pts: [number, number, number][] = Array.from({ length: 50 }, (_, i) => [i * 0.005, 0, 0]);
    const s = simplifyPath(pts);
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual(pts[0]);
    expect(s[11]).toEqual(pts[49]);
  });
});
