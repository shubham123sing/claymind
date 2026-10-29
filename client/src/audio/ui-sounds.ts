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
  /** a success moment (first game played): four rising notes */
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, i === 3 ? 0.5 : 0.16, 0.09, 'triangle', i * 0.12)),
  /** an object taken in the hand: a soft rising pop */
  grab: () => tone(420, 640, 0.06, 0.07),
  /** an object let go: a soft falling note, a little louder for a throw */
  drop: (thrown = false) => tone(360, 200, 0.08, thrown ? 0.08 : 0.05),
  /** a point scored: a bright two-note ding, one step higher for each point this game (up to an octave) */
  score: (step = 0) => {
    const f = 880 * 2 ** (Math.min(step, 12) / 12);
    tone(f, f, 0.12, 0.09, 'triangle');
    tone(f * 1.5, f * 1.5, 0.22, 0.07, 'triangle', 0.07);
  },
  /** refused action */
  bonk: () => tone(220, 140, 0.15, 0.12, 'square'),
};
