/**
 * Pinch detection with hysteresis on thumb-tip / index-tip distance.
 * Pure logic, no WebXR types, so it is unit-testable and reusable by the
 * MediaPipe adapter (tier C) as well as XR hands (tier A).
 */
export interface PinchConfig {
  /** Distance (m) below which a pinch starts. */
  startDistance: number;
  /** Distance (m) above which a pinch ends. Must be > startDistance. */
  endDistance: number;
  /** Frames of lost tracking tolerated before a held pinch is force-ended. */
  lostFrameGrace: number;
}

export const DEFAULT_PINCH: PinchConfig = {
  startDistance: 0.015,
  endDistance: 0.03,
  lostFrameGrace: 6,
};

export type PinchTransition = 'none' | 'start' | 'end';

export class PinchDetector {
  pinching = false;
  lostFrames = 0;
  trackingLosses = 0;
  private wasTracked = false;

  constructor(private config: PinchConfig = DEFAULT_PINCH) {}

  /** Feed one sample. Pass `distance = null` when the hand is not tracked. */
  update(distance: number | null): PinchTransition {
    if (distance === null) {
      if (this.wasTracked) this.trackingLosses++;
      this.wasTracked = false;
      this.lostFrames++;
      if (this.pinching && this.lostFrames > this.config.lostFrameGrace) {
        this.pinching = false;
        return 'end';
      }
      return 'none';
    }
    this.wasTracked = true;
    this.lostFrames = 0;
    if (!this.pinching && distance < this.config.startDistance) {
      this.pinching = true;
      return 'start';
    }
    if (this.pinching && distance > this.config.endDistance) {
      this.pinching = false;
      return 'end';
    }
    return 'none';
  }
}
