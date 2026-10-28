/**
 * Adaptive quality (V6, section 6). 0 = full, 1 = reduced, 2 = low. The PerfGovernor sets it from the
 * measured frame time (and the Performance mode setting pins it to low); effects read it. System-free.
 */
export type QualityLevel = 0 | 1 | 2;

export const quality = {
  level: 0 as QualityLevel,
  /** Frames per second, averaged over the last second or so. */
  fps: 0,
  /** Level changes so far (QA). */
  changes: 0,
};

/** Breakage pieces alive at once, by level. */
export const PIECES_BY_LEVEL = [24, 12, 6] as const;
/** XR fixed foveation (0 none .. 1 most: the edges drawn at lower resolution), by level. */
export const FOVEATION_BY_LEVEL = [0.3, 0.7, 1] as const;
