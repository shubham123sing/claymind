/**
 * Browser-mode toolbar: the same MenuItems as the wrist menu, as HTML buttons
 * in a compact two-column panel at the left edge (the clay stays in view), with
 * the keyboard hint as one line at the bottom.
 */
import type { MenuItem } from './wrist-menu.js';

export class Toolbar {
  private el: HTMLDivElement;
  private tip: HTMLDivElement;
  private buttons: { item: MenuItem; el: HTMLButtonElement }[] = [];

  constructor(items: MenuItem[], hint: string, onTick: () => void = () => {}) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '12px', top: '50%', transform: 'translateY(-50%)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '4px', padding: '6px', borderRadius: '14px', background: 'rgba(20,22,27,0.78)', backdropFilter: 'blur(8px)', zIndex: '10',
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', font: '500 12px system-ui, sans-serif',
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
    document.body.appendChild(this.el);
    document.body.appendChild(tip);
    this.refresh();
  }

  refresh(): void {
    for (const { item, el } of this.buttons) {
      const sel = item.selected?.() ?? false;
      const en = item.enabled?.() ?? true;
      el.style.background = sel ? `#${item.color.toString(16).padStart(6, '0')}` : 'rgba(255,255,255,0.08)';
      el.style.opacity = en ? '1' : '0.4';
      el.disabled = !en;
    }
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? 'grid' : 'none';
    this.tip.style.display = v ? 'block' : 'none';
  }
}
