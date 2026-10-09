/**
 * 1€ filter (Casiez et al. 2012) for jitter reduction on tracked points.
 * Low speed -> heavy smoothing; high speed -> low latency.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, dt: number): number {
    if (this.xPrev === null || dt <= 0) {
      this.xPrev = x;
      return x;
    }
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

/** Three independent 1€ filters for a 3D point. Writes into `out`. */
export class OneEuroFilter3 {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private fz: OneEuroFilter;
  constructor(minCutoff = 1.0, beta = 0.02) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
    this.fz = new OneEuroFilter(minCutoff, beta);
  }
  filter(x: number, y: number, z: number, dt: number, out: Float32Array): void {
    out[0] = this.fx.filter(x, dt);
    out[1] = this.fy.filter(y, dt);
    out[2] = this.fz.filter(z, dt);
  }
  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/**
 * Rolling standard deviation (RMS distance from mean) of a 3D point over a
 * fixed window. Used to measure tracking jitter in millimetres.
 */
export class JitterMeter {
  private buf: Float32Array;
  private count = 0;
  private head = 0;
  constructor(private window = 36) {
    this.buf = new Float32Array(window * 3);
  }
  push(x: number, y: number, z: number): void {
    const i = this.head * 3;
    this.buf[i] = x;
    this.buf[i + 1] = y;
    this.buf[i + 2] = z;
    this.head = (this.head + 1) % this.window;
    if (this.count < this.window) this.count++;
  }
  /** RMS deviation in metres; 0 until the window is full. */
  rms(): number {
    if (this.count < this.window) return 0;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < this.count; i++) {
      mx += this.buf[i * 3];
      my += this.buf[i * 3 + 1];
      mz += this.buf[i * 3 + 2];
    }
    mx /= this.count; my /= this.count; mz /= this.count;
    let s = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.buf[i * 3] - mx;
      const dy = this.buf[i * 3 + 1] - my;
      const dz = this.buf[i * 3 + 2] - mz;
      s += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(s / this.count);
  }
  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}
