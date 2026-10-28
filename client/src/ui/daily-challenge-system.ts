/**
 * Daily challenge (V6 4.5): Play -> Today's challenge says the goal; the game notices when it is
 * done (a creation as it is, a hard throw, a finished game) and shows a small result card (toast,
 * fanfare) with the days-in-a-row streak. Saved in IndexedDB, no backend.
 */
import { createSystem } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { challengeFor, complete, dayKey, DailyState, meets, rollOver, type Challenge, type ChallengeEvent } from '../core/daily-challenge.js';
import { bus } from '../core/event-bus.js';
import { ObjectSystem } from '../objects/object-system.js';
import { idbGet, idbSet } from '../storage/idb.js';

export class DailyChallengeSystem extends createSystem({}) {
  state: DailyState = rollOver(undefined, dayKey(new Date()));
  challenge: Challenge = challengeFor(this.state.day);

  init(): void {
    void idbGet<DailyState>('settings', 'daily').then((s) => !this.state.done && this.today(s));
    const creation = (id: string) => {
      const c = this.world.getSystem(ObjectSystem)?.creationById(id);
      if (c) this.feed({ kind: 'creation', parts: c.parts.length, materials: new Set(c.parts.map((p) => p.materialId)).size, heightCm: c.sizeCm[1] });
    };
    this.cleanupFuncs.push(
      bus.on('creation:baked', (e) => creation(e.creation.id)),
      bus.on('creation:changed', (e) => creation(e.creationId)),
      bus.on('body:released', (e) => this.feed({ kind: 'throw', speed: Math.hypot(e.v[0], e.v[1], e.v[2]) })),
      bus.on('playkit:over', (e) => this.feed({ kind: 'game', result: e.result, score: e.score })),
      bus.on('daily:show', () => bus.emit('ui:toast', { text: this.line() })),
    );
  }

  /** One line for the menu and Settings -> About. */
  line(): string {
    const streak = this.state.streak > 1 ? ` · ${this.state.streak} days in a row` : '';
    return this.state.done ? `Today's challenge done: ${this.challenge.text}${streak}` : `Today's challenge: ${this.challenge.text}${streak}`;
  }

  /** Bring the record to today (the page may stay open past midnight). */
  private today(saved?: DailyState): void {
    const day = dayKey(new Date());
    this.state = rollOver(saved ?? this.state, day);
    this.challenge = challengeFor(day);
  }

  feed(e: ChallengeEvent): void {
    if (this.state.day !== dayKey(new Date())) this.today();
    if (this.state.done || !meets(this.challenge.id, e)) return;
    this.state = complete(this.state);
    void idbSet('settings', 'daily', { ...this.state });
    uiSounds.fanfare();
    const streak = this.state.streak > 1 ? ` (${this.state.streak} days in a row)` : '';
    bus.emit('ui:toast', { text: `Daily challenge done!${streak} A new one tomorrow`, color: '#5fbf72' });
  }
}
