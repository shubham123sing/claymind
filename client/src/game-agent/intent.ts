/**
 * Point + Say (V5): what the player showed and said, as an intent (which item plays which
 * role, the zones and paths marked on the table, the words), and the offline way to a game:
 * the built-in game that fits the roles best, with the player's toys in those roles and their
 * marks as its zones and paths. Pure code, no AI: the player's pointing always wins over a
 * guess (also over the online agent's: its game gets the same roles and marks applied).
 */
import type { GameSpec, Path, RoleSpec, Rule, Zone } from '../playkit/game-spec.js';
import { validateSpec } from '../playkit/game-spec.js';
import { deixis, type BindResult, type Binding, type Word } from './binder.js';
import type { Mark } from './marks.js';

export const ROLE_WORDS = ['ball', 'target', 'goal', 'board', 'tool', 'launcher'] as const;
export type RoleWord = (typeof ROLE_WORDS)[number];

/** Words (English and Hinglish) that name a role. */
const SYNONYMS: Record<string, RoleWord> = {
  ball: 'ball', balls: 'ball', marble: 'ball', marbles: 'ball', coin: 'ball', coins: 'ball', puck: 'ball', piece: 'ball', pieces: 'ball', gend: 'ball', goli: 'ball', goliyan: 'ball',
  target: 'target', targets: 'target', pin: 'target', pins: 'target', tower: 'target', block: 'target', blocks: 'target', can: 'target', cans: 'target', bottle: 'target', bottles: 'target', skittles: 'target',
  goal: 'goal', cup: 'goal', cups: 'goal', hole: 'goal', basket: 'goal', pocket: 'goal', pockets: 'goal', net: 'goal', finish: 'goal', bucket: 'goal',
  board: 'board', table: 'board', field: 'board', court: 'board',
  tool: 'tool', bat: 'tool', paddle: 'tool', club: 'tool', stick: 'tool', racket: 'tool', hammer: 'tool', danda: 'tool', balla: 'tool',
  launcher: 'launcher', striker: 'launcher', ramp: 'launcher', catapult: 'launcher', slingshot: 'launcher', ghulel: 'launcher',
};

export function roleWordOf(text: string): RoleWord | null {
  return SYNONYMS[text.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

export interface RoleAssignment {
  role: RoleWord;
  /** item keys (`toy:<id>` / `c:<id>`) */
  items: string[];
}

export interface Intent {
  roles: RoleAssignment[];
  /** zone marks; `goal` says which one is the goal (default: the first) */
  zones: Mark[];
  paths: Mark[];
  goal?: string;
  text: string;
  /** a game the player named (read by the Intent Resolver) */
  game?: string;
}

const STOP = new Set(['and', 'aur', 'but', 'then', 'phir', 'or']);
/** "throw this", "roll it": what a verb does something to is a ball */
const MOVE_VERBS = new Set(['throw', 'roll', 'flick', 'kick', 'toss', 'shoot', 'drop', 'push', 'fenko', 'phenko', 'maaro', 'daalo', 'gira', 'girao']);
/** "at that": a target; "into that": a goal */
const PREPOSITIONS: Record<string, RoleWord> = { at: 'target', into: 'goal', in: 'goal', inside: 'goal', mein: 'goal', andar: 'goal', down: 'launcher', through: 'launcher', along: 'launcher' };

/** The role said about the pointing word at `index`: a role word after it in its phrase ("this is the ball"), else a cue before it ("throw this", "at that", "ball yeh"). */
function roleNear(words: Word[], index: number): RoleWord | null {
  const clean = (i: number) => words[i].text.toLowerCase().replace(/[^a-z]/g, '');
  for (let i = index + 1; i < words.length && i <= index + 4; i++) {
    const w = clean(i);
    if (STOP.has(w) || (i > index + 1 && deixis(words, i))) break; // the next phrase or the next pointing word
    const role = roleWordOf(w);
    if (role) return role;
    // "this rolls", "isko usme daalo" (Hindi: the verb comes last)
    if (MOVES.has(w) || w === 'daalo' || w === 'dalo' || w === 'fenko' || w === 'phenko') return 'ball';
    if (/[,.;!?]$/.test(words[i].text)) break;
  }
  for (let i = index - 1; i >= 0 && i >= index - 2; i--) {
    const w = clean(i);
    // "look at this" is not aiming at it
    if (w === 'at' && i > 0 && ['look', 'looks', 'see', 'dekho', 'stare'].includes(clean(i - 1))) break;
    if (PREPOSITIONS[w]) return PREPOSITIONS[w];
    if (MOVE_VERBS.has(w)) return 'ball';
    const role = roleWordOf(w);
    if (role) return role;
    if (STOP.has(w) || /[,.;!?]$/.test(words[i].text)) break;
  }
  return null;
}

/**
 * The role named next to each bound pointing word: "this is the ball", "these are the pins",
 * "yeh ball hai", "ball yeh hai". A zone bound to a goal word (or to no role word) is the goal.
 */
export function rolesFromWords(words: Word[], r: BindResult): { roles: RoleAssignment[]; goal?: string; unnamed: Binding[] } {
  const roles: RoleAssignment[] = [];
  const unnamed: Binding[] = [];
  let goal: string | undefined;
  for (const b of r.bindings) {
    const role = roleNear(words, b.index);
    if (b.kind === 'zone') {
      if (role === 'goal' || role === null) goal ??= b.ids[0];
      continue;
    }
    if (b.kind === 'item' && role) addRole(roles, role, b.ids);
    else if (b.kind === 'item') unnamed.push(b);
  }
  return { roles, goal, unnamed };
}

/** Typed words with each bound pointing word replaced by tags ("roll [A] at [B C]") and what each tag is, for the Intent Resolver. */
export function tagged(words: Word[], bindings: Binding[], name: (item: string) => string): { text: string; items: Record<string, string>; refs: Record<string, string> } {
  const items: Record<string, string> = {}, refs: Record<string, string> = {};
  const tagOf = (item: string) => {
    for (const [ref, it] of Object.entries(refs)) if (it === item) return ref;
    const ref = String.fromCharCode(65 + Object.keys(refs).length);
    refs[ref] = item;
    items[ref] = name(item);
    return ref;
  };
  const at = new Map(bindings.filter((b) => b.kind === 'item').map((b) => [b.index, b]));
  const text = words.map((w, i) => (at.has(i) ? `[${at.get(i)!.ids.slice(0, 6).map(tagOf).join(' ')}]` : w.text)).join(' ');
  return { text, items, refs };
}

const FILLER = new Set(['is', 'are', 'the', 'a', 'an', 'my', 'our', 'hai', 'hain', 'ko', 'will', 'be', 'as', 'all', 'of']);
const sameWord = (a: string | undefined, b: string) => !!a && (a === b || a === `${b}s` || a === `${b}es` || b === `${a}s`);

/** Cue words for typed sentences with no role word next to a piece (English and Hinglish). */
const MOVED_BY = new Set(['throw', 'roll', 'flick', 'toss', 'bowl', 'drop', 'kick', 'shoot', 'push', 'send', 'get', 'slide', 'fenko', 'phenko', 'daalo', 'dalo']);
const MOVES = new Set(['rolls', 'roll', 'goes', 'go', 'slides', 'falls', 'drops', 'flies', 'jayega', 'jaati', 'jaata', 'girega']);
const KNOCK = new Set(['knock', 'topple', 'girao', 'gira', 'giraao', 'hit']);
const BUILD = new Set(['stack', 'build', 'pile', 'banao', 'bana', 'jodo']);
/** after a piece's name: it moves (English prepositions) or it holds (Hindi postpositions) */
const AFTER: Record<string, RoleWord> = { into: 'ball', in: 'ball', at: 'ball', to: 'ball', onto: 'ball', toward: 'ball', towards: 'ball', down: 'ball', through: 'ball', past: 'ball', mein: 'goal', me: 'goal', andar: 'goal' };
/** before a piece's name */
const BEFORE: Record<string, RoleWord> = { at: 'target', into: 'goal', inside: 'goal', down: 'launcher', through: 'launcher', along: 'launcher', on: 'board', onto: 'board' };
const JOIN = new Set(['and', 'or', 'aur', 'ya']);

/** The role a sentence's cues give the piece named at words[i .. i+len-1] (null: none). */
function cueRole(words: string[], i: number, len: number): RoleWord | null {
  const verbs = new Set(words);
  const has = (set: Set<string>) => [...set].some((v) => verbs.has(v));
  // after the name
  const next = words[i + len], next2 = words[i + len + 1];
  if (next && AFTER[next]) return AFTER[next];
  if (next && MOVES.has(next)) return 'ball';
  if (next && KNOCK.has(next) && next !== 'hit') return 'target'; // "bottles girao" (Hindi: the object comes before its verb)
  if (next === 'ko') {
    // "goli ko katori mein daalo": what the verb at the end does to it
    const verb = words.slice(i + len + 1).find((w) => MOVED_BY.has(w) || KNOCK.has(w) || BUILD.has(w));
    if (verb) return MOVED_BY.has(verb) ? 'ball' : 'target';
  }
  if (next === 'se') return has(BUILD) ? 'target' : 'ball'; // "lakdi se tower banao" / "gend se bottles girao"
  if (next === 'with' && next2 && KNOCK.has(next2)) return 'ball';
  // before the name (over the / a / an)
  let j = i - 1;
  while (j >= 0 && ['the', 'a', 'an', 'all', 'these', 'those'].includes(words[j])) j--;
  const prev = words[j];
  if (prev === undefined) return null;
  if (MOVED_BY.has(prev)) return 'ball';
  if (KNOCK.has(prev) || BUILD.has(prev)) return 'target';
  if (prev === 'with') return has(BUILD) ? 'target' : has(KNOCK) ? 'tool' : null;
  return BEFORE[prev] ?? null;
}

/**
 * Words only (no hands): pieces named in the words. A role word next to the name first ("the Red
 * ball is the ball", "the blocks are the targets", "cup goal hai"); else the sentence's cues ("toss
 * the sock ball into the basket", "goli ko katori mein daalo", "gend se bottles girao"); pieces
 * joined by and / or share a role ("the mug or the bowl"). A name several pieces share ("Block 1",
 * "Block 2" -> "block") names them all.
 */
export function rolesFromNames(text: string, items: { key: string; name: string }[]): RoleAssignment[] {
  const words = tokens(text);
  const names = items.map((it) => ({ ...it, w: tokens(it.name).filter((x) => !/^\d+$/.test(x) && x.length > 1) })).filter((n) => n.w.length); // "Block 2", "Coin A" -> the shared word
  const out: RoleAssignment[] = [];
  let pending: string[] = [], last: { role: RoleWord; end: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    const hits = names.filter((n) => n.w.every((x, k) => sameWord(words[i + k], x)));
    if (!hits.length) continue;
    const len = Math.max(...hits.map((h) => h.w.length));
    const keys = hits.filter((h) => h.w.length === len).map((h) => h.key);
    let role: RoleWord | null = null, end = i + len - 1;
    for (let j = i + len; j < words.length && j < i + len + 4 && !role; j++) {
      role = roleWordOf(words[j]);
      if (role) end = j; // "the board is the board": the second "board" is the role, not a name
      else if (!FILLER.has(words[j])) break;
    }
    const named = !!role; // "X is the Y" ends its own phrase: its role is not shared over an "and"
    for (let j = i - 1; j >= 0 && j >= i - 2 && !role; j--) role = roleWordOf(words[j]);
    // "the mug or the bowl": the piece before the and / or gives its role
    let k = i - 1;
    while (k >= 0 && ['the', 'a', 'an'].includes(words[k])) k--;
    if (!role && last && JOIN.has(words[k]) && k === last.end + 1) role = last.role;
    role ??= cueRole(words, i, len);
    if (role) {
      addRole(out, role, [...pending, ...keys]);
      pending = [];
      last = named ? null : { role, end };
    } else {
      // no role yet: "the mug and the bowl are goals" gives it to both
      let n = i + len;
      while (words[n] && ['the', 'a', 'an'].includes(words[n])) n++;
      pending = JOIN.has(words[n]) ? [...pending, ...keys] : [];
      last = null;
    }
    i = end;
  }
  return out;
}

/** Add items to a role (an item plays one role: the latest word about it wins). */
export function addRole(roles: RoleAssignment[], role: RoleWord, items: string[]): void {
  for (const r of roles) r.items = r.items.filter((x) => !items.includes(x));
  const at = roles.find((r) => r.role === role);
  if (at) at.items.push(...items);
  else roles.push({ role, items: [...items] });
  for (let i = roles.length - 1; i >= 0; i--) if (!roles[i].items.length) roles.splice(i, 1);
}

/** Can this game role be played by what the player called `w`? */
export function fits(r: RoleSpec, w: RoleWord): boolean {
  switch (w) {
    case 'ball': return !r.pinned && !r.handHeld && (['ball', 'marble', 'coin', 'disc'].includes(r.fallback) || (r.tags[0] === 'piece' && r.fallback !== 'block'));
    case 'target': return !r.handHeld && !r.tags.includes('container') && (r.tags.includes('target') || (r.tags.includes('obstacle') && !r.tags.includes('board')));
    case 'goal': return r.tags.includes('container') || (!!r.pinned && r.tags.includes('target'));
    case 'board': return r.tags.includes('board');
    case 'tool': return !!r.handHeld;
    case 'launcher': return r.tags.includes('launcher');
  }
}

/** The most specific words first, so a striker is the launcher before it could be a ball. */
const ORDER: RoleWord[] = ['tool', 'board', 'goal', 'launcher', 'target', 'ball'];

/** Which game role each role word fills (each game role once). */
export function assignRoles(spec: GameSpec, words: RoleWord[]): { map: Partial<Record<RoleWord, string>>; unplaced: RoleWord[] } {
  const map: Partial<Record<RoleWord, string>> = {};
  const unplaced: RoleWord[] = [];
  const taken = new Set<string>();
  for (const w of [...new Set(words)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))) {
    const r = spec.roles.find((x) => !taken.has(x.id) && fits(x, w));
    if (r) (map[w] = r.id), taken.add(r.id);
    else unplaced.push(w);
  }
  return { map, unplaced };
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/**
 * The built-in game that fits what was shown best (null: nothing shown or said picks one).
 * `nameOf`: what the pieces are called; a piece named like a game's role ("Striker", "Coin 2")
 * breaks a tie toward that game.
 */
export function chooseGame(intent: Intent, games: GameSpec[], nameOf: (item: string) => string = () => ''): { spec: GameSpec; score: number } | null {
  const words = new Set(tokens(`${intent.text} ${intent.game ?? ''}`));
  let best: { spec: GameSpec; score: number } | null = null;
  for (const g of games) {
    const { map, unplaced } = assignRoles(g, intent.roles.map((r) => r.role));
    const filled = Object.keys(map).length;
    // the roles shown, then how much of the game they fill (the most specific game wins a tie)
    let score = 2 * filled - 2 * unplaced.length + filled / g.roles.length;
    for (const a of intent.roles) {
      const role = map[a.role] ? g.roles.find((r) => r.id === map[a.role]) : undefined;
      const label = role ? tokens(`${role.label} ${role.fallback}`) : [];
      if (a.items.some((k) => tokens(nameOf(k)).some((w) => label.some((l) => sameWord(w, l) || sameWord(l, w))))) score += 0.5;
    }
    if (intent.zones.length && g.zones.length) score += 1;
    if (intent.paths.length && (g.paths?.length || g.roles.some((r) => r.fallback === 'marble'))) score += 1;
    const text = ` ${[...words].join(' ')} `, phrase = tokens(g.name).join(' ');
    if (text.includes(` ${phrase} `) || ` ${tokens(intent.text).join(' ')} `.includes(` ${phrase} `)) score += 4;
    else if (tokens(g.name).some((w) => w.length > 3 && !roleWordOf(w) && words.has(w))) score += 1;
    if (!best || score > best.score) best = { spec: g, score };
  }
  return best && best.score > 0 ? best : null;
}

/**
 * The player's roles and marks applied to a game: their toys in the roles they pointed at,
 * their goal mark as its (first) zone, their paths as its paths. `kitOf` gives the kit item
 * an item is (null: a built-in shape, kept as it is).
 */
export function applyIntent(base: GameSpec, intent: Intent, kitOf: (item: string) => string | null): { spec: GameSpec; roleMap: Record<string, string>; notes: string[]; problems: string[] } {
  const spec = structuredClone(base);
  const notes: string[] = [];
  const roleMap: Record<string, string> = {};
  const { map, unplaced } = assignRoles(spec, intent.roles.map((r) => r.role));
  for (const a of intent.roles) {
    const roleId = map[a.role];
    const kitId = roleId ? a.items.map(kitOf).find((k): k is string => !!k) : undefined;
    if (roleId && kitId) roleMap[roleId] = kitId;
  }
  for (const w of unplaced) notes.push(`This game has no ${w}: that one is not used`);
  // zones: the goal mark first, then the others, in place of the game's zones in order
  const marks = [...intent.zones].sort((a, b) => Number(b.id === intent.goal) - Number(a.id === intent.goal));
  marks.slice(0, Math.max(1, spec.zones.length)).forEach((m, i) => {
    const old: Zone | undefined = spec.zones[i];
    const h = old ? old.size[1] : 0.06;
    const zone: Zone = { id: old?.id ?? 'goal', shape: 'cylinder', center: [m.center[0], old ? old.center[1] : h / 2, m.center[2]], size: [m.radius, h, 0] };
    if (old?.value !== undefined) zone.value = old.value;
    if (old) return void (spec.zones[i] = zone);
    // a game with no zones gets the goal: a moving piece in it scores and goes back
    spec.zones.push(zone);
    const mover = (map.ball && spec.roles.find((r) => r.id === map.ball)) || spec.roles.find((r) => !r.pinned && !r.handHeld);
    if (!mover) return;
    const rule: Rule = { when: { type: 'enters_zone', zone: zone.id, role: mover.id }, do: [{ type: 'add_score', points: 1 }, { type: 'show_message', text: 'Goal!' }, { type: 'reset_piece' }] };
    spec.rules.push(rule);
    spec.howToPlay = [...spec.howToPlay.slice(0, 5), `Get the ${mover.label.toLowerCase()} into your goal: 1 point.`];
  });
  if (intent.paths.length) spec.paths = intent.paths.slice(0, 4).map((m): Path => ({ id: m.id, points: m.points.map((p) => [p[0], 0, p[2]]) }));
  if (Object.keys(roleMap).length || intent.zones.length || intent.paths.length) {
    spec.id = `${base.id}-yours`;
    spec.summary = `${base.summary} Set up the way you showed.`.slice(0, 160);
  }
  return { spec, roleMap, notes, problems: validateSpec(spec) };
}
