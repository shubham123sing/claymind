/** Small procedural UI sounds on the shared AudioContext (no assets). */
import { audioContext } from './audio-context.js';

function tone(freq: number, freq2: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0): void {
  const ctx = audioContext();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const uiSounds = {
  /** reasoning-path step / hover */
  tick: (step = 0) => tone(1200 + step * 90, 900 + step * 90, 0.07, 0.08),
  /** an edge was cut */
  snip: () => {
    tone(2400, 600, 0.09, 0.12, 'triangle');
    tone(1800, 400, 0.08, 0.08, 'triangle', 0.05);
  },
  /** a new belief was connected */
  chime: () => {
    tone(660, 660, 0.25, 0.1);
    tone(990, 990, 0.3, 0.08, 'sine', 0.08);
  },
  /** refused action */
  bonk: () => tone(220, 140, 0.15, 0.12, 'square'),
};
