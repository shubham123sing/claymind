/**
 * One shared AudioContext, created/resumed on the first user gesture
 * (browsers block audio before that). Entering XR counts as a gesture.
 * The Sound setting suspends / resumes it (every sound goes through it).
 */
import { onSettings, settings } from '../core/settings.js';

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  return ctx && settings.sound ? ctx : null;
}

export function unlockAudio(): void {
  if (!settings.sound) return;
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
}

onSettings((s) => {
  if (!ctx) return;
  if (s.sound) void ctx.resume();
  else void ctx.suspend();
});

addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
