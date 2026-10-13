/**
 * A short "Deleted X · Undo" offer after something is removed. Browser: a toast
 * with an Undo button. Headset: the text shows as the clay status and the menu's
 * Undo (or Ctrl+Z) takes the offer first. One offer at a time; it lapses after
 * `ms` or when a new one replaces it.
 */
import { bus } from '../core/event-bus.js';
import { settings } from '../core/settings.js';

export const UNDO_MS = 5000;

let pending: { undo: () => void; until: number } | null = null;
let el: HTMLDivElement | null = null;
let timer = 0;

export function offerUndo(text: string, undo: () => void, xr: boolean, ms = UNDO_MS): void {
  pending = { undo, until: performance.now() + ms };
  clearTimeout(timer);
  timer = window.setTimeout(close, ms);
  if (xr) {
    bus.emit('ui:toast', { text: `${text} · Undo within ${Math.round(ms / 1000)} s` });
    return;
  }
  const t = toast();
  t.firstChild!.textContent = text;
  t.style.display = 'flex';
}

/** Run the pending undo if it is still on offer (true when it ran). */
export function takeUndo(): boolean {
  const p = pending;
  close();
  if (!p || performance.now() > p.until) return false;
  p.undo();
  return true;
}

export function hasUndo(): boolean {
  return pending !== null && performance.now() <= pending.until;
}

function close(): void {
  pending = null;
  clearTimeout(timer);
  if (el) el.style.display = 'none';
}

function toast(): HTMLDivElement {
  if (el) {
    const hc = settings.highContrast;
    el.style.background = hc ? '#000' : 'rgba(20,22,27,0.92)';
    el.style.outline = hc ? '2px solid #fff' : 'none';
    return el;
  }
  el = document.createElement('div');
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '72px', transform: 'translateX(-50%)', display: 'none', alignItems: 'center', gap: '14px',
    padding: '8px 8px 8px 16px', borderRadius: '12px', color: '#fff', font: '500 14px system-ui, sans-serif', zIndex: '12',
  });
  el.appendChild(document.createElement('span'));
  const b = document.createElement('button');
  b.textContent = 'Undo';
  Object.assign(b.style, {
    minHeight: '40px', padding: '0 16px', border: '0', borderRadius: '10px', background: '#f0b429', color: '#111',
    font: '700 14px system-ui, sans-serif', cursor: 'pointer',
  });
  b.onclick = () => void takeUndo();
  el.appendChild(b);
  document.body.appendChild(el);
  return toast();
}
