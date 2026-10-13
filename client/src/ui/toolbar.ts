/**
 * Browser-mode toolbar: the same MenuItems as the wrist menu, as HTML buttons
 * in a compact two-column panel at the left edge (the clay stays in view), with
 * the keyboard hint as one line at the bottom. A round button at the bottom
 * left hides or shows all of it (remembered per browser), so the view can show
 * only the clay, the scene and that button.
 */
import { bus } from '../core/event-bus.js';
import { onSettings, settings } from '../core/settings.js';
import type { MenuItem } from './wrist-menu.js';

export class Toolbar {
  private el: HTMLDivElement;
  private tip: HTMLDivElement;
  private buttons: { item: MenuItem; el: HTMLButtonElement }[] = [];
  private toggle: HTMLButtonElement;
  /** Tools shown (the player's choice); `immersive` hides everything but keeps the choice. */
  open = readOpen();
  private immersive = false;

  constructor(items: MenuItem[], hint: string, onTick: () => void = () => {}) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '12px', top: 'calc(50% - 30px)', transform: 'translateY(-50%)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '4px', padding: '6px', borderRadius: '14px', background: 'rgba(20,22,27,0.78)', backdropFilter: 'blur(8px)', zIndex: '10',
      maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', font: '500 12px system-ui, sans-serif',
    });
    for (const item of items) {
      const b = document.createElement('button');
      b.innerHTML = `<span style="font-size:15px;line-height:1;width:16px;text-align:center">${item.icon}</span><span>${item.label}</span>`;
      Object.assign(b.style, {
        display: 'flex', alignItems: 'center', gap: '6px', minWidth: '96px', padding: '7px 9px',
        border: '0', borderRadius: '10px', color: '#fff', cursor: 'pointer', font: 'inherit', transition: 'background 180ms ease-out',
      });
      b.onclick = () => {
        item.onPress();
        onTick();
      };
      this.el.appendChild(b);
      this.buttons.push({ item, el: b });
    }
    const tip = (this.tip = document.createElement('div'));
    tip.textContent = hint;
    Object.assign(tip.style, {
      position: 'fixed', left: '50%', bottom: '10px', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 260px)', textAlign: 'center',
      color: 'rgba(255,255,255,.7)', font: '500 12px system-ui, sans-serif', padding: '6px 12px', borderRadius: '10px',
      background: 'rgba(20,22,27,0.6)', zIndex: '10', pointerEvents: 'none',
    });
    const t = (this.toggle = document.createElement('button'));
    t.setAttribute('aria-label', 'Show or hide tools');
    Object.assign(t.style, {
      position: 'fixed', left: '12px', bottom: '12px', width: '48px', height: '48px', borderRadius: '50%', border: '0',
      color: '#fff', font: '600 20px system-ui, sans-serif', cursor: 'pointer', zIndex: '11', display: 'grid', placeItems: 'center',
    });
    t.onclick = () => {
      this.setOpen(!this.open);
      onTick();
    };
    document.body.appendChild(this.el);
    document.body.appendChild(tip);
    document.body.appendChild(t);
    onSettings(() => this.refresh());
    this.apply();
    this.refresh();
  }

  refresh(): void {
    const hc = settings.highContrast;
    this.el.style.background = hc ? '#000' : 'rgba(20,22,27,0.78)';
    this.el.style.outline = hc ? '2px solid #fff' : 'none';
    this.tip.style.background = hc ? '#000' : 'rgba(20,22,27,0.6)';
    this.tip.style.color = hc ? '#fff' : 'rgba(255,255,255,.7)';
    this.toggle.style.background = hc ? '#000' : 'rgba(20,22,27,0.78)';
    this.toggle.style.outline = hc ? '2px solid #fff' : 'none';
    this.toggle.textContent = this.open ? '✕' : '☰';
    this.toggle.title = this.open ? 'Hide tools' : 'Show tools';
    for (const { item, el } of this.buttons) {
      const sel = item.selected?.() ?? false;
      const en = item.enabled?.() ?? true;
      el.style.background = sel ? `#${item.color.toString(16).padStart(6, '0')}` : hc ? '#222' : 'rgba(255,255,255,0.08)';
      el.style.color = item.danger && !sel ? '#ff8a80' : '#fff';
      el.style.outline = hc ? '1px solid #fff' : 'none';
      el.style.opacity = en ? '1' : '0.4';
      el.disabled = !en;
    }
  }

  /** false in XR: the headset has its own wrist menu. */
  setVisible(v: boolean): void {
    this.immersive = !v;
    this.apply();
  }

  setOpen(open: boolean): void {
    this.open = open;
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* private mode: not remembered */
    }
    this.apply();
    this.refresh();
  }

  private apply(): void {
    const show = this.open && !this.immersive;
    this.el.style.display = show ? 'grid' : 'none';
    this.tip.style.display = show ? 'block' : 'none';
    this.toggle.style.display = this.immersive ? 'none' : 'grid';
    bus.emit('ui:tools', { open: show || this.immersive }); // in XR the welcome card stays as it was
  }
}

const OPEN_KEY = 'claymind.toolsOpen';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}
