/**
 * Procedural sculpt audio (no asset files): a looping filtered-noise "squish"
 * whose loudness and pitch follow sculpting intensity and hand speed, plus
 * short UI ticks. Spatialised at the clay with a PannerNode.
 * Uses the shared AudioContext (unlocked on the first user gesture).
 */
import { audioContext, unlockAudio } from './audio-context.js';

export class SculptAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private panner: PannerNode | null = null;
  private level = 0;
  private target = 0;
  private speed = 0;

  /** Create the squish graph once the shared context exists. Safe to call repeatedly. */
  ensure(): void {
    unlockAudio();
    const ctx = audioContext();
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    // 2 s of brown-ish noise = soft, wet clay texture
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 500;
    this.filter.Q.value = 1.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.3, rolloffFactor: 1 });
    src.connect(this.filter).connect(this.gain).connect(this.panner).connect(ctx.destination);
    src.start();
  }

  /** Called when strokes are being applied this frame. intensity 0..1, speed m/s. */
  sculpting(intensity: number, speed: number): void {
    this.target = Math.max(this.target, intensity);
    this.speed = Math.max(this.speed, speed);
  }

  /** Per-frame: smooth the squish envelope and update 3D positions. */
  tick(dt: number, clay: { x: number; y: number; z: number }, head: { x: number; y: number; z: number; fx: number; fy: number; fz: number }): void {
    if (!this.ctx && audioContext()) this.ensure();
    if (!this.ctx || !this.gain || !this.filter || !this.panner) return;
    const k = this.target > this.level ? 1 - Math.exp(-dt * 25) : 1 - Math.exp(-dt * 8); // fast attack, soft release
    this.level += (this.target - this.level) * k;
    this.target = 0;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(this.level * 0.5, t, 0.02);
    this.filter.frequency.setTargetAtTime(350 + Math.min(1, this.speed / 0.5) * 900, t, 0.05);
    this.speed *= 0.5;
    this.panner.positionX.setValueAtTime(clay.x, t);
    this.panner.positionY.setValueAtTime(clay.y, t);
    this.panner.positionZ.setValueAtTime(clay.z, t);
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.setValueAtTime(head.x, t);
      l.positionY.setValueAtTime(head.y, t);
      l.positionZ.setValueAtTime(head.z, t);
      l.forwardX.setValueAtTime(head.fx, t);
      l.forwardY.setValueAtTime(head.fy, t);
      l.forwardZ.setValueAtTime(head.fz, t);
    }
  }

  /** Short UI tick. `pitch` 1 = normal. */
  tickSound(pitch = 1, volume = 0.15): void {
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(440 * pitch, t + 0.08);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}
