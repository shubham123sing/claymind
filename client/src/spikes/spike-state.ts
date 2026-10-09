/** Shared state for the Phase 0 spike systems (`?spikes`), not used by the game. */
import type { Hud } from '../devtools/hud.js';

export const spike: { hud: Hud | null } = { hud: null };
