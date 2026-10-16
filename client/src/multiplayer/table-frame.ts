/**
 * The shared table frame for a room. Every player sits at their own table (a real one or
 * the virtual one); in the room all tables are the same table: the "canonical" frame has
 * its origin at the table's centre on its top, and each player has a seat around it
 * (by their colour slot: 0 near side, 1 opposite, 2 and 3 the ends). Positions and
 * rotations go out in the canonical frame and come back into each player's own world.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import { surface } from '../platform/surface/surface-system.js';

export const SEAT_COLORS = ['#e2733b', '#5aa9e6', '#5fbf72', '#b48cf2'];
const SEAT_ANGLE = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
const UP = new Vector3(0, 1, 0);

export class TableFrame {
  /** turn of my seat around the table (rad) */
  private seat = 0;
  /** my world direction from the table centre toward me, as a yaw (rad) */
  private yaw = 0;
  private q = new Quaternion();
  private qi = new Quaternion();
  private tmp = new Vector3();

  /** Set from my head position and my colour (call on joining and when the table changes). */
  set(eye: Vector3, color: string): void {
    const i = Math.max(0, SEAT_COLORS.indexOf(color));
    this.seat = SEAT_ANGLE[i];
    this.yaw = Math.atan2(eye.x - surface.centerX, eye.z - surface.centerZ);
    this.q.setFromAxisAngle(UP, this.seat - this.yaw);
    this.qi.copy(this.q).invert();
  }

  /** A turn around Y in my world -> the canonical frame. */
  yawOut(world: number): number {
    return world - this.yaw + this.seat;
  }

  /** A turn around Y in the canonical frame -> the same turn in my world. */
  yawIn(canonical: number): number {
    return canonical + this.yaw - this.seat;
  }

  /** world -> canonical (rounded to mm for the wire) */
  pointOut(p: { x: number; y: number; z: number }): number[] {
    this.tmp.set(p.x - surface.centerX, p.y - surface.topY, p.z - surface.centerZ).applyQuaternion(this.q);
    return [round(this.tmp.x), round(this.tmp.y), round(this.tmp.z)];
  }

  quatOut(q: Quaternion): number[] {
    const r = this.qtmp.copy(this.q).multiply(q);
    return [r.x, r.y, r.z, r.w].map((v) => Math.round(v * 1e4) / 1e4);
  }
  private qtmp = new Quaternion();

  /** canonical -> world */
  pointIn(c: ArrayLike<number>, out: Vector3): Vector3 {
    return out.set(c[0], c[1], c[2]).applyQuaternion(this.qi).add(this.tmp.set(surface.centerX, surface.topY, surface.centerZ));
  }

  quatIn(c: ArrayLike<number>, out: Quaternion): Quaternion {
    return out.set(c[0], c[1], c[2], c[3]).premultiply(this.qi);
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** The page's table frame while in a room. */
export const tableFrame = new TableFrame();
