/**
 * Movable panels (V6 gap 1). In the headset every panel has a small grab bar above its top edge:
 * pinch the bar and drag, and the panel stays where you let go (relative to where it would stand,
 * so it still follows the clay). Recenter puts every panel back. Hands only; the browser keeps
 * fixed panels.
 *
 * Runs after the systems that place panels (they set the pose each frame) and before the object
 * and sculpt systems, so a pinch on a bar is claimed before it can grab or sculpt.
 */
import { createSystem, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from '@iwsdk/core';
import { uiSounds } from '../audio/ui-sounds.js';
import { bus, Handedness } from '../core/event-bus.js';
import { input } from '../platform/input/input-system.js';
import { CanvasPanel } from './canvas-panel.js';

const BAR_W = 0.06, BAR_H = 0.011;
/** How far (bar-local, m) from the bar a pinch still takes it: generous for seated, shaky hands. */
const REACH_X = BAR_W / 2 + 0.012, REACH_Y = 0.02, REACH_Z = 0.03;
/** A moved panel stays within this distance (m) of its own place: it cannot be lost. */
const MAX_MOVE = 0.6;
const IDLE = 0x9aa7b4, NEAR = 0xe8eef4, HELD = 0x5fbf72;

interface Bar {
  mesh: Mesh;
  mat: MeshBasicMaterial;
}

export class PanelMoverSystem extends createSystem({}) {
  private bars = new Map<CanvasPanel, Bar>();
  private drag: { panel: CanvasPanel; side: Handedness; last: Vector3 } | null = null;
  private geo = new PlaneGeometry(BAR_W, BAR_H);
  private p = new Vector3();
  private w = new Vector3();
  private eye = new Vector3();
  /** Moves made by hand (QA). */
  moves = 0;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('view:recenter', () => {
        for (const pn of CanvasPanel.all) pn.moved.set(0, 0, 0);
        this.letGo();
      }),
    );
  }

  private bar(pn: CanvasPanel): Bar {
    let b = this.bars.get(pn);
    if (!b) {
      const mat = new MeshBasicMaterial({ color: IDLE, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
      const mesh = new Mesh(this.geo, mat);
      mesh.position.set(0, pn.size[1] / 2 + BAR_H, 0.001);
      mesh.renderOrder = 30;
      pn.mesh.add(mesh);
      b = { mesh, mat };
      this.bars.set(pn, b);
    }
    return b;
  }

  private onScreen(o: Object3D): boolean {
    for (let x: Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
    return true;
  }

  private letGo(): void {
    if (this.drag && input.claims[this.drag.side] === 'panel') input.claims[this.drag.side] = null;
    this.drag = null;
  }

  update(): void {
    const xr = input.xr;
    this.world.camera.getWorldPosition(this.eye);
    if (this.drag) {
      const h = input.hands[this.drag.side];
      if (!xr || !h.tracked || !h.pinching || !this.onScreen(this.drag.panel.mesh)) {
        if (this.drag.panel.moved.lengthSq() > 0) this.moves++;
        uiSounds.drop();
        this.letGo();
      } else {
        this.p.fromArray(h.pinchPoint);
        this.drag.panel.moved.add(this.w.copy(this.p).sub(this.drag.last));
        if (this.drag.panel.moved.length() > MAX_MOVE) this.drag.panel.moved.setLength(MAX_MOVE);
        this.drag.last.copy(this.p);
      }
    }
    CanvasPanel.eye.copy(this.eye);
    CanvasPanel.moving = xr;
    for (const pn of CanvasPanel.all) {
      if (!pn.movable) continue;
      const b = this.bar(pn);
      b.mesh.visible = xr && !pn.follows;
      if (!this.onScreen(pn.mesh)) {
        pn.forgetPlace();
        continue;
      }
      pn.applyMove();
      if (!b.mesh.visible) continue;
      // the grab bar: brighter for a free hand near it, green while held
      let near = false;
      if (!this.drag) {
        for (const h of input.both) {
          if (!h.tracked || input.claims[h.side]) continue;
          b.mesh.worldToLocal(this.p.fromArray(h.pinchPoint));
          const over = Math.abs(this.p.x) < REACH_X && Math.abs(this.p.y) < REACH_Y && Math.abs(this.p.z) < REACH_Z;
          near ||= over;
          if (over && h.pinchStarted) {
            this.drag = { panel: pn, side: h.side, last: new Vector3().fromArray(h.pinchPoint) };
            input.claims[h.side] = 'panel';
            uiSounds.grab();
            break;
          }
        }
      }
      b.mat.color.setHex(this.drag?.panel === pn ? HELD : near ? NEAR : IDLE);
    }
  }
}
