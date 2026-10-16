/**
 * InputProvider port: every input device (XR hands, mouse/touch, webcam hands)
 * is reduced to the same per-hand state. Game logic only reads HandState.
 * All positions are world-space metres.
 */
import type { Handedness } from '../../core/event-bus.js';

export type Vec3 = [number, number, number];

export interface HandState {
  readonly side: Handedness;
  tracked: boolean;
  /** Pinch (thumb+index) held. */
  pinching: boolean;
  /** Pinch went down / up this frame. */
  pinchStarted: boolean;
  pinchEnded: boolean;
  /** Smoothed midpoint between thumb and index tips (grab/drag anchor). */
  pinchPoint: Vec3;
  /** Where a tool acts (XR: pinch point; mouse: current surface hit). */
  aimPoint: Vec3;
  /** Smoothed index fingertip. */
  indexTip: Vec3;
  /** Index extended, other fingers curled. */
  pointing: boolean;
  /** A fist with the thumb up (a thumbs-up). */
  thumbsUp: boolean;
  /** All fingers extended, not pinching. */
  palmOpen: boolean;
  palmCenter: Vec3;
  /** Unit normal out of the palm. */
  palmNormal: Vec3;
  /** Fingertip speed in m/s (drives sound). */
  speed: number;
  /** Frames since tracking resumed; tools ignore the first few (stale poses). */
  stableFrames: number;
}

export function createHandState(side: Handedness): HandState {
  return {
    side,
    tracked: false,
    pinching: false,
    pinchStarted: false,
    pinchEnded: false,
    pinchPoint: [0, 0, 0],
    aimPoint: [0, 0, 0],
    indexTip: [0, 0, 0],
    pointing: false,
    thumbsUp: false,
    palmOpen: false,
    palmCenter: [0, 0, 0],
    palmNormal: [0, 1, 0],
    speed: 0,
    stableFrames: 0,
  };
}

export interface InputProvider {
  readonly id: string;
  /** Active when this provider currently drives the hands (e.g. XR session running). */
  active(): boolean;
  /** Fill hand states for this frame. */
  update(hands: Record<Handedness, HandState>, dt: number): void;
}
