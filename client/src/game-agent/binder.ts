/**
 * Point + Say (V5): binds the pointing words in what the player says ("this", "that", "here",
 * "these", "idhar", "yeh", "itna", ...) to what their hands showed at about the same time
 * (pointed at an item, held one, held it up, tapped it, marked a zone or a path on the table).
 * Pure code: no AI, deterministic, runs offline and is tested exactly.
 *
 * Rules:
 * - a word binds to the gesture nearest in time within BIND_MS before or after it;
 * - object words ("this", "yeh", "it") prefer items; place words ("here", "idhar", "yahan")
 *   prefer zones and paths; "itna" (this much) prefers a zone;
 * - plural words ("these", "those", "ye sab") take every item shown in their window;
 * - holding or holding up an item outweighs a passing point (STRENGTH);
 * - one gesture is used by one word (in order), unless the same item is meant twice;
 * - no gesture in the window: the item pointed at or held right now, if any, else unresolved;
 * - two different candidates almost equally near in time: ambiguous (one short confirm card).
 */

export type GestureKind = 'point' | 'hold' | 'holdup' | 'tap' | 'zone' | 'path';

export interface Attention {
  /** ms (performance.now) */
  t: number;
  gesture: GestureKind;
  itemId?: string;
  zone?: string;
  path?: string;
}

export interface Word {
  text: string;
  /** when it was said / typed / picked (ms) */
  t: number;
}

export type TargetKind = 'item' | 'zone' | 'path';

export interface Binding {
  /** index of the word in the utterance */
  index: number;
  word: string;
  kind: TargetKind;
  ids: string[];
  /** ms between the word and its gesture (0 for "now") */
  dt: number;
}

export interface BindResult {
  bindings: Binding[];
  unresolved: { index: number; word: string }[];
  ambiguous: { index: number; word: string; options: string[] }[];
}

export const BIND_MS = 2000;
const TIE_MS = 300;
/** A held or held-up item is a stronger "this one" than a passing point (counts as this many ms nearer). */
const STRENGTH: Record<GestureKind, number> = { holdup: 500, hold: 400, tap: 150, point: 0, zone: 0, path: 0 };

const OBJECT_WORDS = new Set(['this', 'that', 'it', 'yeh', 'ye', 'yah', 'woh', 'wo', 'vo', 'iska', 'isko', 'isse', 'uska', 'usko', 'is', 'us']);
const PLACE_WORDS = new Set(['here', 'there', 'idhar', 'udhar', 'yahan', 'yaha', 'wahan', 'waha', 'idar', 'udar']);
const PLURAL_WORDS = new Set(['these', 'those', 'them']);
const AMOUNT_WORDS = new Set(['itna', 'utna', 'itni', 'utni']);

/** Which deixis word is it (null: not one)? Plural also for "ye sab" / "these ones". */
export function deixis(words: Word[], i: number): 'object' | 'place' | 'plural' | 'amount' | null {
  const w = words[i].text.toLowerCase().replace(/[^a-z]/g, '');
  const next = words[i + 1]?.text.toLowerCase().replace(/[^a-z]/g, '');
  if (PLURAL_WORDS.has(w) || ((w === 'ye' || w === 'yeh' || w === 'woh' || w === 'wo') && (next === 'sab' || next === 'saare' || next === 'sare'))) return 'plural';
  if (AMOUNT_WORDS.has(w)) return 'amount';
  if (PLACE_WORDS.has(w)) return 'place';
  // "this is", "that one", "it": objects; "is" / "us" only count in Hindi word order ("is ko", "us ball")
  if ((w === 'is' || w === 'us') && !(next === 'ko' || next === 'ka' || next === 'ki' || next === 'ke')) return null;
  return OBJECT_WORDS.has(w) ? 'object' : null;
}

function kindOf(a: Attention): TargetKind {
  return a.zone ? 'zone' : a.path ? 'path' : 'item';
}

function idOf(a: Attention): string {
  return a.zone ?? a.path ?? a.itemId ?? '';
}

/**
 * `now`: the item pointed at and the items held when the player finished (fallback when a
 * word had no gesture of its own in time).
 */
export function bind(words: Word[], attention: Attention[], now: { pointed?: string | null; held?: string[] } = {}): BindResult {
  const res: BindResult = { bindings: [], unresolved: [], ambiguous: [] };
  const used = new Set<Attention>();
  const events = [...attention].sort((a, b) => a.t - b.t);
  words.forEach((word, index) => {
    const d = deixis(words, index);
    if (!d) return;
    const want: TargetKind[] = d === 'place' ? ['zone', 'path', 'item'] : d === 'amount' ? ['zone', 'path'] : ['item'];
    const near = events.filter((a) => Math.abs(a.t - word.t) <= BIND_MS && want.includes(kindOf(a)) && idOf(a));
    if (d === 'plural') {
      const ids = [...new Set(near.map(idOf))];
      if (ids.length) {
        near.forEach((a) => used.add(a));
        res.bindings.push({ index, word: word.text, kind: 'item', ids, dt: Math.min(...near.map((a) => Math.abs(a.t - word.t))) });
      } else if (now.held?.length) res.bindings.push({ index, word: word.text, kind: 'item', ids: [...now.held], dt: 0 });
      else res.unresolved.push({ index, word: word.text });
      return;
    }
    // the preferred kind first, then nearest in time; unused gestures before reused ones
    const rank = (a: Attention) => want.indexOf(kindOf(a)) * 10000 + (used.has(a) ? 5000 : 0) + Math.abs(a.t - word.t) - STRENGTH[a.gesture];
    const sorted = near.sort((a, b) => rank(a) - rank(b));
    const best = sorted[0];
    if (!best) {
      const fallback = d === 'object' ? now.pointed ?? (now.held?.length === 1 ? now.held[0] : null) : null;
      if (fallback) res.bindings.push({ index, word: word.text, kind: 'item', ids: [fallback], dt: 0 });
      else res.unresolved.push({ index, word: word.text });
      return;
    }
    const rival = sorted.find((a) => a !== best && idOf(a) !== idOf(best) && kindOf(a) === kindOf(best) && !used.has(a) && Math.abs(rank(a) - rank(best)) < TIE_MS);
    if (rival) {
      res.ambiguous.push({ index, word: word.text, options: [idOf(best), idOf(rival)] });
      return;
    }
    used.add(best);
    res.bindings.push({ index, word: word.text, kind: kindOf(best), ids: [idOf(best)], dt: Math.abs(best.t - word.t) });
  });
  return res;
}
