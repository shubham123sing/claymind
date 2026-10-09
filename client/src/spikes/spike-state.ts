/** Shared state for the Phase 0 spike systems (not used by the game). */
import type { Hud } from '../devtools/hud.js';

export const TABLE = {
  /** Virtual table used when no real table plane is detected. */
  centerX: 0,
  centerZ: -0.45,
  width: 0.8,
  depth: 0.5,
  thickness: 0.03,
  topY: 0.72,
};

export const spike: {
  hud: Hud | null;
  /** Top surface height of the surface we drop onto (virtual or real). */
  tableTopY: number;
  realTable: boolean;
} = { hud: null, tableTopY: TABLE.topY, realTable: false };
