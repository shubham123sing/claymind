/**
 * Break debris: one InstancedMesh of small tetrahedra simulated on the CPU
 * (ballistic, bounce on the surface below, shrink out). No physics bodies,
 * no per-frame allocation. Also used for small chips on hard impacts.
 */
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, TetrahedronGeometry, Vector3 } from '@iwsdk/core';

const MAX = 160;

export class Shards {
  readonly mesh: InstancedMesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private spin = new Float32Array(MAX * 3);
  private next = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();
  private axis = new Vector3();
  private color = new Color();

  constructor() {
    this.mesh = new InstancedMesh(new TetrahedronGeometry(1), new MeshStandardMaterial({ roughness: 0.5 }), MAX);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
  }

  burst(x: number, y: number, z: number, hex: string, count: number, speed: number, size = 0.006): void {
    this.color.set(hex);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const th = Math.random() * Math.PI * 2, up = 0.3 + Math.random() * 0.9;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pos.set([x + (Math.random() - 0.5) * 0.02, y + Math.random() * 0.01, z + (Math.random() - 0.5) * 0.02], i * 3);
      this.vel.set([Math.cos(th) * sp, up * sp, Math.sin(th) * sp], i * 3);
      this.spin.set([Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10], i * 3);
      this.life[i] = 1.2 + Math.random() * 0.6;
      this.size[i] = size * (0.5 + Math.random());
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** floorAt(x, z) = height of the surface below (table top or floor). */
  update(dt: number, floorAt: (x: number, z: number) => number): void {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.81 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const fy = floorAt(this.pos[o], this.pos[o + 2]) + this.size[i] * 0.5;
      if (this.pos[o + 1] < fy && this.vel[o + 1] < 0) {
        this.pos[o + 1] = fy;
        this.vel[o + 1] *= -0.3;
        this.vel[o] *= 0.6;
        this.vel[o + 2] *= 0.6;
        this.spin[o] *= 0.5; this.spin[o + 1] *= 0.5; this.spin[o + 2] *= 0.5;
      }
      const sc = this.life[i] > 0.3 ? this.size[i] : this.size[i] * Math.max(0, this.life[i] / 0.3);
      const t = 1.6 - this.life[i];
      this.axis.set(this.spin[o], this.spin[o + 1], this.spin[o + 2]);
      const ang = this.axis.length() * t;
      this.q.setFromAxisAngle(ang > 0 ? this.axis.normalize() : this.axis.set(0, 1, 0), ang);
      this.m.compose(this.v.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]), this.q, this.s.setScalar(Math.max(0, sc)));
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
