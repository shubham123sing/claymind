import { describe, expect, it } from 'vitest';
import { DEAD_BAND, MAX_SHIFT, viewShift } from '../../src/platform/seated-height.js';

describe('seated height', () => {
  it('leaves a normal chair alone', () => {
    expect(viewShift(1.15, 0.72, 0)).toBe(0);
    expect(viewShift(1.2, 0.72, 0)).toBe(0);
  });

  it('raises the view on a low seat and lowers it when standing', () => {
    expect(viewShift(0.95, 0.72, 0)).toBeCloseTo(0.22);
    expect(viewShift(1.6, 0.72, 0)).toBeCloseTo(-0.43);
  });

  it('a nudge moves the table, never past the limit', () => {
    expect(viewShift(1.15, 0.72, 0.03)).toBeCloseTo(-0.03); // table higher: the view goes down
    expect(viewShift(0.2, 0.72, 0)).toBe(MAX_SHIFT);
    expect(Math.abs(viewShift(1.17 + DEAD_BAND / 2, 0.72, 0))).toBe(0);
  });
});
