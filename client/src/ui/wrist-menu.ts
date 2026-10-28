/**
 * Palm-up wrist menu (non-dominant hand). Buttons are poked with the other
 * hand's index fingertip. Two levels (Update 3): the categories (Make, Material &
 * Colour, Paint, Physics, Place & Pin, Library, Play Kit, Multiplayer, Settings);
 * a category opens its actions with a Back button first. Opens when the palm faces up for ~0.2 s, animates in
 * with an ease-out scale, and stays face-on to the user's head.
 * One-handed setting: `updateFixed` keeps it open beside the clay instead,
 * poked by either hand, with a small Hide / Tools button above it that folds
 * the menu down to that one button (the palm-up menu hides by itself).
 * Reduced motion: no ease, no hover growth.
 */
import {
  CanvasTexture, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Vector3,
} from '@iwsdk/core';
import { settings } from '../core/settings.js';
import type { HandState } from '../platform/input/hand-state.js';

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  /** Accent colour when selected/active. */
  color: number;
  /** Returns true if shown as selected/on. */
  selected?: () => boolean;
  enabled?: () => boolean;
  /** Erases something (drawn in red so it is never confused with a harmless action). */
  danger?: boolean;
  /** A small icon-only button in a row under the categories (Settings, Help). */
  small?: boolean;
  /** A category: pressing it shows these (with Back) instead of calling onPress. */
  children?: MenuItem[];
  onPress: () => void;
}

/** A category is shown as selected when one of its actions is (e.g. the current tool). */
export function itemSelected(item: MenuItem): boolean {
  return item.selected?.() ?? item.children?.some((c) => c.selected?.() ?? false) ?? false;
}

const BTN = 0.036; // 3.6 cm buttons (>= 3 cm hit targets)
const GAP = 0.008;
/** Drawn after the floating cards and pickers (21-22): the menu under your fingertip is never covered. */
const MENU_ORDER = 25;
/** Small buttons (Settings, Help): 0.8 of a button, about 2.9 cm, icon only. */
const SMALL = 0.8;
/** Columns: 3 for the categories (about 13 cm wide), 4 for a category's actions. */
function colsFor(n: number): number {
  return n <= 3 ? n : n <= 9 ? 3 : 4;
}
const OPEN_DELAY = 0.2;

interface Button {
  item: MenuItem;
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  state: string;
  wasFront: boolean;
}

export class WristMenu {
  readonly root = new Group();
  private panel = new Group();
  private buttons: Button[] = [];
  private openTime = 0;
  private openAmount = 0;
  private lastPress = 0;
  /** after a press, nothing is pressed again until the fingertip has left every button (one push, one press) */
  private held = false;
  private tmp = new Vector3();
  private local = new Vector3();
  private head = new Vector3();
  isOpen = false;
  /** The category whose actions are shown (null: the categories). */
  group: MenuItem | null = null;
  private top: MenuItem[];
  private back: MenuItem;
  /** One-handed menu folded down to its Hide / Tools button. */
  collapsed = false;
  private toggle: Button;

  constructor(items: MenuItem[], private onTick: () => void) {
    this.root.add(this.panel);
    this.top = items;
    this.back = { id: 'back', label: 'Back', icon: '◀', color: 0x8fa3b8, onPress: () => this.openGroup(null) };
    for (const item of [this.back, ...items, ...items.flatMap((g) => g.children ?? [])]) this.buttons.push(this.makeButton(item));
    const toggleItem: MenuItem = {
      id: 'tools', label: 'Hide', icon: '▾', color: 0x8fa3b8,
      onPress: () => {
        this.collapsed = !this.collapsed;
        toggleItem.label = this.collapsed ? 'Tools' : 'Hide';
        toggleItem.icon = this.collapsed ? '☰' : '▾';
        this.toggle.state = ''; // redraw
      },
    };
    this.toggle = this.makeButton(toggleItem);
    this.buttons.push(this.toggle);
    this.openGroup(null);
    this.root.visible = false;
  }

  private makeButton(item: MenuItem): Button {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(BTN, BTN), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.renderOrder = MENU_ORDER;
    mesh.visible = false;
    this.panel.add(mesh);
    return { item, mesh, canvas, tex, state: '', wasFront: false };
  }

  /** The items on screen now. */
  private shown(): MenuItem[] {
    return this.group ? [this.back, ...(this.group.children ?? [])] : this.top;
  }

  /** Show a category's actions (null: the categories), laid out as a centred grid. */
  openGroup(group: MenuItem | null): void {
    this.group = group;
    const all = this.shown(), items = all.filter((x) => !x.small), small = all.filter((x) => x.small);
    const cols = colsFor(items.length), rows = Math.ceil(items.length / cols);
    for (const b of this.buttons) b.wasFront = false;
    items.forEach((item, i) => {
      const b = this.buttons.find((x) => x.item === item)!;
      const col = i % cols, row = Math.floor(i / cols);
      b.mesh.position.set((col - (cols - 1) / 2) * (BTN + GAP), ((rows - 1) / 2 - row) * (BTN + GAP), 0);
    });
    // the small icons in one row under the grid, at its right end
    small.forEach((item, i) => {
      const b = this.buttons.find((x) => x.item === item)!;
      const w = BTN * SMALL + GAP;
      b.mesh.position.set(((cols - 1) / 2) * (BTN + GAP) + (BTN - BTN * SMALL) / 2 - (small.length - 1 - i) * w, (-(rows - 1) / 2 - 1) * (BTN + GAP) + (BTN - BTN * SMALL) / 2, 0);
    });
    // the Hide button above the top-left button
    this.toggle.mesh.position.set(-((cols - 1) / 2) * (BTN + GAP), ((rows - 1) / 2 + 1) * (BTN + GAP) + GAP, 0);
  }

  /** Palm-up: every tool button, no Hide button. One-handed: Hide button, tools unless folded. */
  private layout(fixed: boolean): void {
    const shown = this.shown();
    for (const b of this.buttons) b.mesh.visible = b === this.toggle ? fixed : shown.includes(b.item) && !(fixed && this.collapsed);
  }

  /**
   * menuHand: the hand showing its palm. poker: the other hand.
   * headObj: the camera. Returns true while the menu is open (suppress sculpting with the menu hand).
   */
  update(menuHand: HandState, poker: HandState, headObj: Object3D, dt: number, now: number): boolean {
    const palmUp = menuHand.tracked && menuHand.palmNormal[1] > 0.55 && !menuHand.pinching;
    this.openTime = palmUp ? this.openTime + dt : 0;
    const wantOpen = this.openTime > OPEN_DELAY;
    this.ease(wantOpen, dt);
    if (!this.root.visible) return false;
    this.layout(false);

    // float 7 cm above the palm, facing the head
    headObj.getWorldPosition(this.head);
    this.root.position.set(
      menuHand.palmCenter[0] + menuHand.palmNormal[0] * 0.07,
      menuHand.palmCenter[1] + menuHand.palmNormal[1] * 0.07,
      menuHand.palmCenter[2] + menuHand.palmNormal[2] * 0.07,
    );
    this.root.lookAt(this.head);
    this.root.scale.setScalar(0.6 + 0.4 * this.openAmount);
    this.pokeButtons([poker], now);
    return this.isOpen;
  }

  /** One-handed: always open at `at` (world), facing the head; either hand pokes. */
  updateFixed(at: Vector3, pokers: HandState[], headObj: Object3D, dt: number, now: number): boolean {
    this.ease(true, dt);
    headObj.getWorldPosition(this.head);
    this.root.position.copy(at);
    this.root.lookAt(this.head);
    this.root.scale.setScalar(0.6 + 0.4 * this.openAmount);
    this.layout(true);
    this.pokeButtons(pokers, now);
    return this.isOpen;
  }

  private ease(wantOpen: boolean, dt: number): void {
    // ease-out ~200 ms (instant with reduced motion)
    const target = wantOpen ? 1 : 0;
    this.openAmount = settings.reducedMotion ? target : this.openAmount + (target - this.openAmount) * (1 - Math.exp(-dt * 14));
    this.isOpen = this.openAmount > 0.5;
    this.root.visible = this.openAmount > 0.02;
  }

  private pokeButtons(pokers: HandState[], now: number): void {
    let touching = false;
    for (const b of this.buttons) {
      if (!b.mesh.visible) {
        b.wasFront = false;
        continue;
      }
      const enabled = b.item.enabled?.() ?? true;
      let hover = false;
      for (const poker of pokers) {
        if (!poker.tracked || !this.isOpen) continue;
        this.tmp.set(poker.indexTip[0], poker.indexTip[1], poker.indexTip[2]);
        this.local.copy(this.tmp);
        b.mesh.worldToLocal(this.local);
        const inside = Math.abs(this.local.x) < BTN / 2 && Math.abs(this.local.y) < BTN / 2;
        const front = this.local.z > 0.006;
        // press = fingertip crosses the button plane from the front
        const h = inside && this.local.z < 0.03 && this.local.z > -0.02;
        hover ||= h;
        touching ||= inside && this.local.z < 0.03;
        // the layout changes after a press (a category opens, Back): the same push must not press what moved under it
        if (inside && b.wasFront && !front && this.local.z > -0.02 && enabled && !this.held && now - this.lastPress > 350) {
          this.lastPress = now;
          this.held = true;
          if (b.item.children) this.openGroup(b.item);
          else b.item.onPress();
          this.onTick();
        }
        if (inside || pokers.length === 1) b.wasFront = inside ? front : true;
      }
      this.draw(b, hover, enabled);
    }
    if (!touching) this.held = false;
  }

  private draw(b: Button, hover: boolean, enabled: boolean): void {
    const selected = itemSelected(b.item);
    const key = `${hover}|${enabled}|${selected}|${settings.highContrast}`;
    if (key === b.state) return;
    b.state = key;
    const ctx = b.canvas.getContext('2d')!;
    const accent = `#${b.item.color.toString(16).padStart(6, '0')}`;
    ctx.clearRect(0, 0, 192, 192);
    const hc = settings.highContrast;
    ctx.fillStyle = selected ? accent : hover ? (hc ? '#555' : 'rgba(70,74,84,0.95)') : hc ? '#000' : 'rgba(28,30,36,0.9)';
    ctx.beginPath();
    ctx.roundRect(6, 6, 180, 180, 36);
    ctx.fill();
    if (hover || hc) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.globalAlpha = enabled ? 1 : 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 72px system-ui, sans-serif';
    if (b.item.small) {
      ctx.font = '600 96px system-ui, sans-serif';
      ctx.fillText(b.item.icon, 96, 100);
    } else {
      ctx.fillText(b.item.icon, 96, 82);
      ctx.font = '600 32px system-ui, sans-serif';
      if (b.item.danger && !selected) ctx.fillStyle = '#ff8a80';
      ctx.fillText(b.item.label, 96, 152, 180);
    }
    ctx.globalAlpha = 1;
    b.tex.needsUpdate = true;
    b.mesh.scale.setScalar((b.item.small ? SMALL : 1) * (hover && !settings.reducedMotion ? 1.06 : 1));
  }
}
