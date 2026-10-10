/** Build/URL feature flags. Plan v3 (docs/PLAN.md) hides the brain graph from players. */
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/**
 * Show the Phase 3-5 brain graph, Debug-the-Brain agent and Mastery screen.
 * Off for players (`?devKgView` turns it on for development). The brain itself
 * always runs: it stores knowledge and corrections behind the scenes.
 */
export const devKgView = params.has('devKgView');
