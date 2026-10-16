/** Build/URL feature flags. Plan v4 (docs/PLAN.md): sculpt, material, colour, paint, real physics. No AI. */
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/**
 * Show the Phase 3-5 brain graph, Debug-the-Brain agent and Mastery screen.
 * Off for players (`?devKgView` turns it on for development). The brain itself
 * still records creations behind the scenes (no network, no UI).
 */
export const devKgView = params.has('devKgView');

/**
 * The Phase 4 AI layer (vision naming, image-to-3D) and local template
 * matching. Off in plan v4: no network calls, every piece starts as clay and
 * the sculpt is never replaced by a template. `?devAi` brings it back for development.
 */
export const devAi = params.has('devAi');
