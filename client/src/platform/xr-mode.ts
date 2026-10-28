/**
 * Which kind of immersive session is running: VR (an opaque view, ClayMind draws the room) or
 * mixed reality (passthrough: the player's own room shows through). Both are entered from the
 * welcome card; the same hands-only app runs in both.
 */
import type { WebGLRenderer } from '@iwsdk/core';

/** True while an immersive session shows the real room (passthrough / mixed reality). */
export function passthroughOn(renderer: WebGLRenderer): boolean {
  const s = renderer.xr.getSession?.();
  return !!s && s.environmentBlendMode !== undefined && s.environmentBlendMode !== 'opaque';
}
