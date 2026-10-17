/**
 * The hosted backend (game agent + multiplayer relay) the public build uses when no `?agents=`
 * address is given. Not a secret: the server keeps its keys. Render free web service, see
 * render.yaml; it sleeps when idle, so the first call after a quiet spell can take about a minute.
 *
 * Empty until the Render service exists: the public build then makes no backend calls at all and
 * says "offline" at once (no failed requests in the console). Put the service's URL here, e.g.
 * 'https://claymind-agents.onrender.com', once it is up.
 */
export const PUBLIC_AGENTS_URL = '';
