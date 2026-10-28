/**
 * Player settings (plan v4, section 7: accessibility), saved in IndexedDB.
 * Systems read `settings` directly; `onSettings` tells them when it changed.
 */
import { idbGet, idbSet } from '../storage/idb.js';

export interface Settings {
  /** Less movement: no hover bobbing, no clay breathing, menus appear without easing. */
  reducedMotion: boolean;
  /** Opaque dark panels, white text, thicker outlines. */
  highContrast: boolean;
  /** The left hand sculpts and catches; the right palm opens the menu. */
  leftHanded: boolean;
  /** The menu floats beside the clay (no palm-up gesture), poke it with either hand. */
  oneHanded: boolean;
  sound: boolean;
  /** Bigger headset panels and text (V6 4.6). */
  largeText: boolean;
  /** Simpler effects for a steadier frame rate (the governor's low level, always). */
  performanceMode: boolean;
  tutorialDone: boolean;
  /** Vision check (online, off by default): pictures of a toy added to the Play Kit go to the game agent's free vision model. */
  vision: boolean;
}

export const settings: Settings = {
  reducedMotion: false, highContrast: false, leftHanded: false, oneHanded: false, sound: true, largeText: false, performanceMode: false, tutorialDone: false, vision: false,
};

const listeners = new Set<(s: Settings) => void>();

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  for (const fn of listeners) fn(settings);
  void idbSet('settings', 'prefs', { ...settings });
}

/** Load once at start (2 s timeout: storage must never block the game). */
export const settingsReady: Promise<void> = Promise.race([
  idbGet<Partial<Settings>>('settings', 'prefs').then((s) => {
    if (s) Object.assign(settings, s);
    for (const fn of listeners) fn(settings);
  }),
  new Promise<void>((r) => setTimeout(r, 2000)),
]);
