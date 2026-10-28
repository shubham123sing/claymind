/**
 * Daily challenge (V6 4.5): one small goal a day, picked from the date alone (no backend, the same
 * for everyone on the same day), checked by the game itself from what happens on the table.
 * Pure logic, unit-tested; DailyChallengeSystem feeds it events and keeps the streak.
 */
export type ChallengeId = 'tower' | 'parts3' | 'twoMaterials' | 'throwHard' | 'score3' | 'win';

export interface Challenge {
  id: ChallengeId;
  text: string;
}

export const CHALLENGES: Challenge[] = [
  { id: 'tower', text: 'Make a tower at least 20 cm tall and bring it to life' },
  { id: 'parts3', text: 'Make one creation from three pieces (Join them)' },
  { id: 'twoMaterials', text: 'Give one creation two different materials' },
  { id: 'throwHard', text: 'Throw a creation of yours, hard' },
  { id: 'score3', text: 'Score 3 or more in one game' },
  { id: 'win', text: 'Win a game' },
];

/** What the checks look at: a creation as it is now, a throw, or a finished game. */
export type ChallengeEvent =
  | { kind: 'creation'; parts: number; materials: number; heightCm: number }
  | { kind: 'throw'; speed: number }
  | { kind: 'game'; result: 'win' | 'lose' | 'done'; score: number };

/** A throw counts as hard from this release speed (m/s); a gentle toss is about 1. */
export const HARD_THROW = 2;

/** The local calendar day, 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days since 1970-01-01 for a day key (calendar arithmetic only, no time zones). */
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Today's challenge: steps 5 through the list of 6, so two days in a row never repeat. */
export function challengeFor(key: string): Challenge {
  const n = CHALLENGES.length;
  return CHALLENGES[(((dayNumber(key) * 5) % n) + n) % n];
}

export function meets(c: ChallengeId, e: ChallengeEvent): boolean {
  switch (c) {
    case 'tower':
      return e.kind === 'creation' && e.heightCm >= 20;
    case 'parts3':
      return e.kind === 'creation' && e.parts >= 3;
    case 'twoMaterials':
      return e.kind === 'creation' && e.materials >= 2;
    case 'throwHard':
      return e.kind === 'throw' && e.speed >= HARD_THROW;
    case 'score3':
      return e.kind === 'game' && e.score >= 3;
    case 'win':
      return e.kind === 'game' && e.result === 'win';
  }
}

export interface DailyState {
  /** The day this record is about. */
  day: string;
  done: boolean;
  /** Days in a row with the challenge done, up to `lastDone`. */
  streak: number;
  lastDone: string | null;
}

/** The record for `today`, carried over from what was saved (a new day starts not done). */
export function rollOver(saved: DailyState | undefined, today: string): DailyState {
  if (!saved) return { day: today, done: false, streak: 0, lastDone: null };
  if (saved.day === today) return saved;
  // a missed day breaks the streak
  const kept = saved.lastDone && dayNumber(today) - dayNumber(saved.lastDone) <= 1 ? saved.streak : 0;
  return { day: today, done: false, streak: kept, lastDone: saved.lastDone };
}

/** Mark today done (once). */
export function complete(s: DailyState): DailyState {
  if (s.done) return s;
  const inRow = s.lastDone !== null && dayNumber(s.day) - dayNumber(s.lastDone) === 1;
  return { day: s.day, done: true, streak: inRow ? s.streak + 1 : 1, lastDone: s.day };
}
