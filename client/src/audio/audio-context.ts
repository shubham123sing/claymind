/**
 * One shared AudioContext, created/resumed on the first user gesture
 * (browsers block audio before that). Entering XR counts as a gesture.
 */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  return ctx;
}

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
}

addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
