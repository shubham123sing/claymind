/**
 * Procedural impact sounds (no asset files): modal synthesis from the
 * material's `sound` block (partials, base pitch, decay, noise), with random
 * pitch ±5% and loudness from impact speed. Spatialised at the impact point.
 * Shares the AudioContext owned by SculptAudio.
 */
import type { Material } from '../materials/materials.js';

const MAX_VOICES = 10;

export class ImpactAudio {
  private voices = 0;
  private noiseBuf: AudioBuffer | null = null;

  constructor(private getCtx: () => AudioContext | null) {}

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** speed = impact Δv (m/s). */
  impact(m: Material, speed: number, x: number, y: number, z: number, opts: { brk?: boolean } = {}): void {
    const ctx = this.getCtx();
    if (!ctx || this.voices >= MAX_VOICES) return;
    const loud = Math.min(1, Math.max(0.04, speed / 3.5)) * m.sound.gain * (opts.brk ? 1.3 : 1);
    if (loud < 0.05) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = loud * 0.5;
    const pan = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.3, rolloffFactor: 1, positionX: x, positionY: y, positionZ: z });
    out.connect(pan).connect(ctx.destination);
    const pitch = 1 + (Math.random() - 0.5) * 0.1;
    let end = 0;
    m.sound.partials.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = m.sound.base * ratio * pitch;
      const decay = m.sound.decay / Math.sqrt(ratio) * (opts.brk ? 0.6 : 1);
      const amp = (1 - m.sound.noise) / (1 + i * 0.8);
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * 5);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + decay * 5 + 0.02);
      end = Math.max(end, decay * 5);
    });
    // noise burst: the knock / crunch part of the sound
    const n = ctx.createBufferSource();
    n.buffer = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = m.sound.base * (opts.brk ? 1.5 : 1);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    const nLen = opts.brk ? 0.22 : 0.04 + m.sound.noise * 0.05;
    ng.gain.setValueAtTime(m.sound.noise * (opts.brk ? 1.6 : 1), t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + nLen);
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + nLen + 0.01);
    this.voices++;
    setTimeout(() => {
      this.voices--;
      out.disconnect();
    }, (Math.max(end, nLen) + 0.1) * 1000);
  }
}
