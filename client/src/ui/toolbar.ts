/** Browser-mode toolbar: the same MenuItems as the wrist menu, as HTML buttons. */
import type { MenuItem } from './wrist-menu.js';

export class Toolbar {
  private el: HTMLDivElement;
  private buttons: { item: MenuItem; el: HTMLButtonElement }[] = [];

  constructor(items: MenuItem[], hint: string, onTick: () => void = () => {}) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', display: 'flex', gap: '6px',
      padding: '6px', borderRadius: '16px', background: 'rgba(20,22,27,0.78)', backdropFilter: 'blur(8px)', zIndex: '10',
      maxWidth: 'calc(100vw - 32px)', flexWrap: 'wrap', justifyContent: 'center', font: '500 14px system-ui, sans-serif',
    });
    for (const item of items) {
      const b = document.createElement('button');
      b.innerHTML = `<span style="font-size:18px;line-height:1">${item.icon}</span><span>${item.label}</span>`;
      Object.assign(b.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: '58px', padding: '8px 10px',
        border: '0', borderRadius: '12px', color: '#fff', cursor: 'pointer', font: 'inherit', transition: 'background 180ms ease-out',
      });
      b.onclick = () => {
        item.onPress();
        onTick();
      };
      this.el.appendChild(b);
      this.buttons.push({ item, el: b });
    }
    const tip = document.createElement('div');
    tip.textContent = hint;
    Object.assign(tip.style, { width: '100%', textAlign: 'center', color: 'rgba(255,255,255,.65)', fontSize: '12px', padding: '2px 0 0' });
    this.el.appendChild(tip);
    document.body.appendChild(this.el);
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
    this.el.style.display = v ? 'flex' : 'none';
  }
}
