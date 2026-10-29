/**
 * Frame-rate governor (V6, section 6): watches the frame time and steps quality down when the frame
 * rate stays low (below about 55 fps for 3 s), and back up when it has been comfortably fast for 10 s.
 * Knobs: XR fixed foveation, how many breakage pieces live at once, the desktop pixel ratio; the clay
 * worker lowers its own resolution when strokes get slow (SculptClient). Performance mode (Settings)
 * pins the low level.
 */
import { createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { FOVEATION_BY_LEVEL, quality, type QualityLevel } from '../core/quality.js';
import { onSettings, settings } from '../core/settings.js';

const SLOW_MS = 18;
const FAST_MS = 14.5;
const DOWN_AFTER_S = 3;
const UP_AFTER_S = 10;

export class PerfGovernorSystem extends createSystem({}) {
  private avg = 16;
  private slowFor = 0;
  private fastFor = 0;
  private warm = 0;

  init(): void {
    this.cleanupFuncs.push(onSettings(() => this.apply(settings.performanceMode ? 2 : quality.level)));
    this.apply(settings.performanceMode ? 2 : 0);
  }

  update(delta: number): void {
    // ignore the first seconds (loading) and long pauses (a hidden tab, the session starting)
    if (delta <= 0 || delta > 0.25) return;
    this.warm += delta;
    const ms = delta * 1000;
    this.avg += (ms - this.avg) * 0.05;
    quality.fps = Math.round(1000 / this.avg);
    if (this.warm < 4 || settings.performanceMode) return;
    this.slowFor = this.avg > SLOW_MS ? this.slowFor + delta : 0;
    this.fastFor = this.avg < FAST_MS ? this.fastFor + delta : 0;
    if (this.slowFor > DOWN_AFTER_S && quality.level < 2) {
      this.apply((quality.level + 1) as QualityLevel);
      this.slowFor = 0;
    } else if (this.fastFor > UP_AFTER_S && quality.level > 0) {
      this.apply((quality.level - 1) as QualityLevel);
      this.fastFor = 0;
    }
  }

  private apply(level: QualityLevel): void {
    const changed = level !== quality.level;
    quality.level = level;
    const r = this.world.renderer;
    try {
      r.xr.setFoveation?.(FOVEATION_BY_LEVEL[level]);
    } catch {
      /* not every browser supports foveation */
    }
    if (!r.xr.isPresenting) r.setPixelRatio(Math.min(devicePixelRatio, level === 0 ? 2 : level === 1 ? 1.5 : 1));
    if (changed) {
      quality.changes++;
      console.info(`[perf] ${quality.fps} fps: quality ${['full', 'reduced', 'low'][level]}`);
      if (!settings.performanceMode && level > 0) bus.emit('ui:toast', { text: 'Keeping it smooth: simpler effects for now' });
    }
  }
}
