/** Shared AI on/off state + stats (read by menus, HUD and, in Phase 5, the Mastery screen). */
export type AiMode = 'auto' | 'server' | 'mock' | 'off';

export const aiState = {
  mode: 'auto' as AiMode,
  /** Active provider name ('server', 'local-mock', 'none'). */
  provider: 'none',
  /** True while a server answered /health. */
  serverUp: false,
  stats: {
    describes: 0,
    models: 0,
    cacheHits: 0,
    failures: 0,
    lastDescribeMs: 0,
    lastModelMs: 0,
  },
};

export function aiEnabled(): boolean {
  return aiState.mode !== 'off' && aiState.provider !== 'none';
}
