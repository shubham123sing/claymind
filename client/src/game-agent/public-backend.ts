/**
 * The hosted backend (game agent + multiplayer relay) the public build uses when no `?agents=`
 * address is given. Not a secret: the server keeps its keys. Render free web service, see
 * render.yaml; it sleeps when idle, so the first call after a quiet spell can take about a minute.
 * Empty string: the public build makes no backend calls at all and says "offline" at once.
 */
export const PUBLIC_AGENTS_URL = 'https://claymind-agents.onrender.com';
