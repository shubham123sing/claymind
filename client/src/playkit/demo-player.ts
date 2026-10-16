/**
 * "Show me how to play": a translucent ghost hand plays a few turns on the real table with
 * the real physics and the live scoreboard, using the same planner as the headless runs
 * (demo-planner.ts: only the game's hand actions, human-range speeds). Labelled
 * "Demo" (never to be shown as the player's own hand use). Pause, slow motion, replay and
 * "my turn" (stop here and play on from exactly this state). At most 20 s.
 */
import { CanvasTexture, CapsuleGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { Planner, type Action, type PieceView, type V3 } from './demo-planner.js';
import type { GameSpec } from './game-spec.js';

export const DEMO_MAX_S = 20;

export interface DemoHost {
  views(): PieceView[];
  toyIdOf(key: string): string | undefined;
  /** play-area point / direction -> world */
  toWorld(p: V3, out?: Vector3): Vector3;
  dirToWorld(v: V3): V3;
  hold(toyId: string): boolean;
  move(toyId: string, at: Vector3): void;
  release(toyId: string, vWorld: V3): void;
  flick(toyId: string, vWorld: V3): void;
  gameOver(): boolean;
}

type Phase = { t: number; dur: number; from: Vector3; to: Vector3; holding?: string; onEnd?: () => void };

function ghostHand(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: 0x9fd0f5, transparent: true, opacity: 0.45, depthWrite: false });
  const palm = new Mesh(new SphereGeometry(0.035, 16, 12), mat);
  palm.scale.set(1, 0.45, 1.15);
  g.add(palm);
  [-0.024, -0.008, 0.008, 0.024].forEach((x, i) => {
    const f = new Mesh(new CapsuleGeometry(0.008, 0.035 - Math.abs(i - 1.5) * 0.005, 4, 8), mat);
    f.rotation.x = Math.PI / 2;
    f.position.set(x, 0, -0.055);
    g.add(f);
  });
  const thumb = new Mesh(new CapsuleGeometry(0.009, 0.025, 4, 8), mat);
  thumb.rotation.set(Math.PI / 2, 0, 0.9);
  thumb.position.set(0.04, 0, -0.02);
  g.add(thumb);
  // "Demo" label above it
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(14,16,20,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 88, 28);
  ctx.fill();
  ctx.fillStyle = '#9fd0f5';
  ctx.font = '700 56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Demo', 128, 50);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const label = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  label.scale.set(0.06, 0.0225, 1);
  label.position.set(0, 0.06, 0);
  g.add(label);
  g.visible = false;
  return g;
}

export class DemoPlayer {
  readonly ghost = ghostHand();
  running = false;
  paused = false;
  speed = 1;
  private planner: Planner | null = null;
  private phases: Phase[] = [];
  private elapsed = 0;
  private sinceAction = 99;
  private seed = 1;
  private rest = new Vector3();
  private tmp = new Vector3();

  constructor(private host: DemoHost, private spec: GameSpec) {}

  setSpec(spec: GameSpec): void {
    this.spec = spec;
  }

  start(seed: number): void {
    this.seed = seed;
    this.planner = new Planner(this.spec, seed);
    this.phases = [];
    this.elapsed = 0;
    this.sinceAction = 99;
    this.running = true;
    this.paused = false;
    this.host.toWorld([0.25, 0.15, 0.2], this.rest);
    this.ghost.position.copy(this.rest);
    this.ghost.visible = true;
  }

  replaySeed(): number {
    return this.seed;
  }

  /** "My turn" or Stop: the ghost goes, everything stays exactly as it is. */
  stop(): void {
    this.running = false;
    this.phases = [];
    this.ghost.visible = false;
  }

  update(dt: number, faceTo: Vector3): void {
    if (!this.running || this.paused) return;
    const d = dt * this.speed;
    this.elapsed += d;
    this.ghost.lookAt(faceTo.x, this.ghost.position.y, faceTo.z);
    this.ghost.rotateY(Math.PI);
    if (this.phases.length) {
      const ph = this.phases[0];
      ph.t += d;
      const k = Math.min(1, ph.t / ph.dur), e = k * k * (3 - 2 * k);
      this.ghost.position.lerpVectors(ph.from, ph.to, e);
      if (ph.holding) this.host.move(ph.holding, this.tmp.copy(this.ghost.position).setY(this.ghost.position.y - 0.03));
      if (k >= 1) {
        this.phases.shift();
        ph.onEnd?.();
        if (this.phases[0]) this.phases[0].from.copy(this.ghost.position);
      }
      return;
    }
    this.sinceAction += d;
    if (this.elapsed > DEMO_MAX_S || this.host.gameOver()) return this.stop();
    const views = this.host.views();
    const moving = views.some((p) => !p.fixed && p.speed > 0.05);
    if (this.sinceAction < 0.8 || (moving && this.sinceAction < 3)) return;
    const a = this.planner!.next(views);
    if (!a) return this.stop();
    this.sinceAction = 0;
    this.plan(a, views);
  }

  private go(to: Vector3, dur: number, extra: Partial<Phase> = {}): void {
    this.phases.push({ t: 0, dur, from: this.ghost.position.clone(), to: to.clone(), ...extra });
  }

  private plan(a: Action, views: PieceView[]): void {
    const id = this.host.toyIdOf(a.key);
    const piece = views.find((v) => v.key === a.key);
    if (!id || !piece) return;
    const at = this.host.toWorld([piece.p[0], piece.p[1] + 0.03, piece.p[2]]);
    if (a.kind === 'flick') {
      // fingertip just behind the piece, then through it
      const l = Math.hypot(a.v[0], a.v[2]) || 1, back: V3 = [piece.p[0] - (a.v[0] / l) * 0.06, piece.p[1] + 0.01, piece.p[2] - (a.v[2] / l) * 0.06];
      this.go(this.host.toWorld(back), 0.6);
      this.go(this.host.toWorld([piece.p[0], piece.p[1] + 0.01, piece.p[2]]), 0.1, { onEnd: () => this.host.flick(id, this.host.dirToWorld(a.v)) });
      this.go(this.rest, 0.6);
      return;
    }
    this.go(at, 0.6, { onEnd: () => void this.host.hold(id) });
    if (a.kind === 'throw') {
      const from = this.host.toWorld([a.from[0], a.from[1] + 0.03, a.from[2]]);
      const back = from.clone().addScaledVector(new Vector3(...this.host.dirToWorld(a.v)).normalize(), -0.08); // wind-up
      this.go(back, 0.35, { holding: id });
      this.go(from, 0.12, { holding: id, onEnd: () => this.host.release(id, this.host.dirToWorld(a.v)) });
    } else {
      const to = this.host.toWorld([a.at[0], a.at[1] + 0.03, a.at[2]]);
      this.go(to, 0.7, { holding: id, onEnd: () => this.host.release(id, a.kind === 'place' ? this.host.dirToWorld([0, -0.05, 0]) : [0, -0.01, 0]) });
    }
    this.go(this.rest, 0.6);
  }
}
