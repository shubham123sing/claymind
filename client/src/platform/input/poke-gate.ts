/**
 * Poke intent (V6, 4.3): a fingertip presses a button only when it came at it from the front.
 * The tip has to hover over the same button, in front of the surface (within 10 cm), for a short
 * moment, then cross the surface. A hand sweeping in from the side, a hand already behind the
 * panel, a pinching (grabbing, sculpting) hand or a quick brush past the panel presses nothing.
 * Pure logic, unit-tested; every canvas panel and the wrist menu use it.
 */
export interface PokeConfig {
  /** In front of the surface by more than this (m) = "in front". */
  frontZ: number;
  /** Further than this (m) in front does not count as aiming. */
  reachZ: number;
  /** Deeper than this (m) behind the surface: the hand went through, no press. */
  backZ: number;
  /** Hover over one button at least this long (ms) before the press counts. */
  dwellMs: number;
  /** No second press within this time (ms). */
  cooldownMs: number;
}

export const DEFAULT_POKE: PokeConfig = { frontZ: 0.006, reachZ: 0.1, backZ: -0.02, dwellMs: 60, cooldownMs: 400 };

export class PokeGate {
  private since = -1;
  private aimed: string | null = null;
  private lastPress = -Infinity;
  /** Presses refused for lack of intent (QA). */
  refused = 0;

  constructor(private config: PokeConfig = DEFAULT_POKE) {}

  /**
   * One sample. `inside`: the tip is over the panel; `z`: its distance in front of the surface
   * (negative = behind); `id`: the button under it; `blocked`: this hand must not poke (pinching).
   * Returns the pressed button, or null.
   */
  update(inside: boolean, z: number, id: string | null, now: number, blocked = false): string | null {
    const c = this.config;
    if (!inside || blocked || z > c.reachZ) {
      this.since = -1;
      this.aimed = null;
      return null;
    }
    if (z > c.frontZ) {
      if (this.since < 0 || id !== this.aimed) {
        this.since = now;
        this.aimed = id;
      }
      return null;
    }
    // at or behind the surface: a press only straight after a steady aim from the front
    const aimed = this.since >= 0 ? this.aimed : null;
    const steady = this.since >= 0 && now - this.since >= c.dwellMs;
    this.since = -1;
    this.aimed = null;
    if (!aimed) return null;
    if (z <= c.backZ || id !== aimed || !steady || now - this.lastPress < c.cooldownMs) {
      this.refused++;
      return null;
    }
    this.lastPress = now;
    return id;
  }

  /** Aiming at a button now (the caller may keep a slightly larger hit box while aiming: shaky hands). */
  get aiming(): boolean {
    return this.since >= 0;
  }

  reset(): void {
    this.since = -1;
    this.aimed = null;
  }
}
