/**
 * Palm-up wrist menu (non-dominant hand). Buttons are poked with the other
 * hand's index fingertip. Opens when the palm faces up for ~0.2 s, animates in
 * with an ease-out scale, and stays face-on to the user's head.
 * One-handed setting: `updateFixed` keeps it open beside the clay instead,
 * poked by either hand. Reduced motion: no ease, no hover growth.
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
  onPress: () => void;
}

const BTN = 0.036; // 3.6 cm buttons (>= 3 cm hit targets)
const GAP = 0.008;
const COLS = 3;
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
  private tmp = new Vector3();
  private local = new Vector3();
  private head = new Vector3();
  isOpen = false;

  constructor(items: MenuItem[], private onTick: () => void) {
    this.root.add(this.panel);
    const rows = Math.ceil(items.length / COLS);
    items.forEach((item, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(new PlaneGeometry(BTN, BTN), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      const col = i % COLS, row = Math.floor(i / COLS);
      mesh.position.set((col - (COLS - 1) / 2) * (BTN + GAP), ((rows - 1) / 2 - row) * (BTN + GAP), 0);
      mesh.renderOrder = 20;
      this.panel.add(mesh);
      this.buttons.push({ item, mesh, canvas, tex, state: '', wasFront: false });
    });
    this.root.visible = false;
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
    for (const b of this.buttons) {
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
        if (inside && b.wasFront && !front && this.local.z > -0.02 && enabled && now - this.lastPress > 350) {
          this.lastPress = now;
          b.item.onPress();
          this.onTick();
        }
        if (inside || pokers.length === 1) b.wasFront = inside ? front : true;
      }
      this.draw(b, hover, enabled);
    }
  }

  private draw(b: Button, hover: boolean, enabled: boolean): void {
    const selected = b.item.selected?.() ?? false;
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
    ctx.fillText(b.item.icon, 96, 82);
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(b.item.label, 96, 152);
    ctx.globalAlpha = 1;
    b.tex.needsUpdate = true;
    b.mesh.scale.setScalar(hover && !settings.reducedMotion ? 1.06 : 1);
  }
}
