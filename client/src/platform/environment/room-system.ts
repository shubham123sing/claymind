/**
 * The VR room (V6): a calm, warm studio around the work table, so VR is never an empty void.
 * Shown in the browser view and in VR; hidden in mixed reality, where the player's own room shows
 * through. The table's legs (and its top, when a real desk is the work surface) follow the work
 * surface, so what the hands touch is what the eyes see. Physics is unchanged: floor, walls and the
 * table colliders stay in SurfaceSystem. Low-poly and unlit-cheap: about a dozen meshes, no shadows.
 */
import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, createSystem, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, SRGBColorSpace, VisibilityState,
} from '@iwsdk/core';
import { surface, VIRTUAL_TABLE } from '../surface/surface-system.js';
import { passthroughOn } from '../xr-mode.js';

const ROOM = { halfW: 3, halfD: 3, height: 2.8 };
const LEG = 0.035;

/** The view through the window, drawn once (V6, 4.4): a soft sky, far hills, a window frame. No image files. */
function windowView(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 280;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 280);
  sky.addColorStop(0, '#9cc7e6');
  sky.addColorStop(0.65, '#e3eef4');
  sky.addColorStop(1, '#f6ead8');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 280);
  // two soft rows of hills
  const hills = (y: number, amp: number, color: string, phase: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 280);
    for (let x = 0; x <= 512; x += 8) g.lineTo(x, y - amp * (Math.sin(x / 70 + phase) * 0.6 + Math.sin(x / 31 + phase * 2) * 0.25));
    g.lineTo(512, 280);
    g.fill();
  };
  hills(210, 22, '#a9c4a4', 0.4);
  hills(240, 16, '#86ad85', 2.1);
  // the frame: a border and two bars
  g.fillStyle = '#f2ece3';
  g.fillRect(0, 0, 512, 10);
  g.fillRect(0, 270, 512, 10);
  g.fillRect(0, 0, 10, 280);
  g.fillRect(502, 0, 10, 280);
  g.fillRect(251, 0, 10, 280);
  g.fillRect(0, 135, 512, 8);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class RoomSystem extends createSystem({}) {
  private room = new Group();
  private table = new Group();
  private top!: Mesh;
  private legs: Mesh[] = [];
  private shownVersion = -1;
  private shown = true;

  init(): void {
    const mat = (color: number, roughness = 0.9, emissive?: number) => new MeshStandardMaterial({ color, roughness, metalness: 0, ...(emissive ? { emissive: new Color(emissive), emissiveIntensity: 0.9 } : {}) });
    const floorMat = mat(0x8a6a4f, 0.8), wallMat = mat(0xe9e1d6), trimMat = mat(0xcfc3b3), rugMat = mat(0x6f8fa6, 1), woodMat = mat(0x9b7b5e, 0.85);
    const add = (m: Mesh) => (this.room.add(m), m);

    // floor and a round rug under the table
    const floor = add(new Mesh(new PlaneGeometry(ROOM.halfW * 2, ROOM.halfD * 2), floorMat));
    floor.rotation.x = -Math.PI / 2;
    const rug = add(new Mesh(new CircleGeometry(1.1, 40), rugMat));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(VIRTUAL_TABLE.centerX, 0.004, VIRTUAL_TABLE.centerZ + 0.3);
    // four walls with a skirting trim
    const walls: [number, number, number, number][] = [
      [0, -ROOM.halfD, 0, ROOM.halfW * 2], [0, ROOM.halfD, Math.PI, ROOM.halfW * 2],
      [-ROOM.halfW, 0, Math.PI / 2, ROOM.halfD * 2], [ROOM.halfW, 0, -Math.PI / 2, ROOM.halfD * 2],
    ];
    for (const [x, z, ry, w] of walls) {
      const wall = add(new Mesh(new PlaneGeometry(w, ROOM.height), wallMat));
      wall.position.set(x, ROOM.height / 2, z);
      wall.rotation.y = ry;
      const trim = add(new Mesh(new BoxGeometry(w, 0.1, 0.02), trimMat));
      trim.position.set(x, 0.05, z);
      trim.rotation.y = ry;
    }
    // a big soft "window" of daylight on the wall in front, and a shelf with clay pots on the left
    const window = add(new Mesh(new PlaneGeometry(2.2, 1.2), new MeshBasicMaterial({ map: windowView(), toneMapped: false })));
    window.position.set(0, 1.55, -ROOM.halfD + 0.01);
    const shelf = add(new Mesh(new BoxGeometry(0.3, 0.04, 1.4), woodMat));
    shelf.position.set(-ROOM.halfW + 0.16, 1.1, -0.6);
    [0xe2733b, 0x5aa9e6, 0xf0b429].forEach((c, i) => {
      const pot = add(new Mesh(new CylinderGeometry(0.07, 0.05, 0.14, 20), mat(c, 0.7)));
      pot.position.set(-ROOM.halfW + 0.16, 1.19, -1.05 + i * 0.42);
    });
    // a ceiling, so looking up is not a void
    const ceiling = add(new Mesh(new PlaneGeometry(ROOM.halfW * 2, ROOM.halfD * 2), mat(0xf4efe8)));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM.height;

    // the work table: four legs (and a top when the surface is a real desk), following the surface
    this.top = new Mesh(new BoxGeometry(1, VIRTUAL_TABLE.thickness, 1), woodMat);
    this.table.add(this.top);
    for (let i = 0; i < 4; i++) {
      const leg = new Mesh(new BoxGeometry(LEG, 1, LEG), woodMat);
      this.legs.push(leg);
      this.table.add(leg);
    }

    this.world.createTransformEntity(this.room);
    this.world.createTransformEntity(this.table);
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(() => this.applyMode()));
  }

  /** Room and table only where ClayMind draws the world: the browser view and VR, not passthrough. */
  private applyMode(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.shown = !(immersive && passthroughOn(this.world.renderer));
    this.room.visible = this.shown;
    this.shownVersion = -1;
  }

  update(): void {
    if (surface.version === this.shownVersion) return;
    this.shownVersion = surface.version;
    // the virtual table draws its own top; a real desk (VR at a real table) gets one drawn here
    const s = surface, t = this.table;
    t.visible = this.shown;
    t.position.set(s.centerX, 0, s.centerZ);
    t.rotation.y = s.yaw;
    this.top.visible = s.real;
    this.top.scale.set(s.halfW * 2, 1, s.halfD * 2);
    this.top.position.y = s.topY - VIRTUAL_TABLE.thickness / 2;
    const h = Math.max(0.05, s.topY - VIRTUAL_TABLE.thickness);
    this.legs.forEach((leg, i) => {
      leg.scale.y = h;
      leg.position.set((i % 2 ? 1 : -1) * (s.halfW - 0.06), h / 2, (i < 2 ? 1 : -1) * (s.halfD - 0.06));
    });
  }
}
