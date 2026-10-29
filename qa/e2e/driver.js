/*
 * In-page driver for the XR end-to-end test: moves IWER's emulated hands (programmatic control
 * mode, frame by frame) and reads ClayMind's state through its ?debug hooks. Every action is a
 * hand action: a pinch, a fingertip poke on a menu button or a panel region, a hand movement.
 * Loaded with page.addScriptTag after the app is up; everything lives on window.qa.
 */
(() => {
  const w = window;
  const dev = () => w.IWER_DEVICE;
  const sys = () => w.__sys;
  const input = () => w.__input;
  const V = () => w.__world.camera.position.constructor; // three's Vector3 from the app's own instance
  const frameNo = () => w.__world.renderer.info.render.frame;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Wait n rendered frames (timers, not rAF: rAF stops during an XR session). */
  async function frames(n = 1, maxMs = 8000) {
    const f0 = frameNo(), t0 = performance.now();
    while (frameNo() - f0 < n && performance.now() - t0 < maxMs) await sleep(4);
    return frameNo() - f0;
  }

  /** Frames per second over `ms`. */
  async function fps(ms = 1500) {
    const f0 = frameNo(), t0 = performance.now();
    await sleep(ms);
    return Math.round(((frameNo() - f0) * 1000) / (performance.now() - t0) * 10) / 10;
  }

  // ---------- XR session ----------

  async function enterXR() {
    const d = dev();
    d.controlMode = 'programmatic';
    d.primaryInputMode = 'hand';
    d.position.set(0, 1.15, 0);
    // seated, looking down at the table (25 degrees)
    const a = (-25 * Math.PI) / 180 / 2;
    d.quaternion.set(Math.sin(a), 0, 0, Math.cos(a));
    d.grantOfferedSession();
    for (let i = 0; i < 150 && !input().xr; i++) await sleep(100);
    await frames(10);
    // hands to rest, in front of the body
    for (const s of ['left', 'right']) {
      const h = d.hands[s];
      h.poseId = 'default';
      h.updateHandPose?.();
      h.setPinchValueImmediate?.(0);
      h.position.set(s === 'left' ? -0.2 : 0.2, 0.85, -0.15);
    }
    await frames(10);
    // where the pinch point sits relative to the device hand once the hand is closed (the emulator
    // jumps between poses: closing moves the pinch point by several cm), measured at rest
    for (const s of ['left', 'right']) {
      const h = d.hands[s];
      pinchCurve[s] = [];
      for (let k = 0; k <= 8; k++) {
        h.setPinchValueImmediate?.(k / 8);
        await frames(k === 8 ? 10 : 5);
        const p = input().hands[s].pinchPoint;
        pinchCurve[s].push([p[0] - h.position.x, p[1] - h.position.y, p[2] - h.position.z]);
      }
      pinchOffset[s] = pinchCurve[s][8];
      h.setPinchValueImmediate?.(0);
      await frames(6);
    }
    return { xr: input().xr, left: input().hands.left.tracked, right: input().hands.right.tracked, pinchOffset };
  }

  // ---------- hands ----------

  const pinchOffset = { left: [0, 0, 0], right: [0, 0, 0] };
  /** the pinch point's offset at each of 9 pinch values (0 .. 1) */
  const pinchCurve = { left: [], right: [] };
  const H = (side) => input().hands[side];
  const D = (side) => dev().hands[side];

  /** The world point of a hand feature the app sees: 'pinch' (pinch point), 'tip' (index tip), 'palm'. */
  function point(side, which) {
    const h = H(side);
    const p = which === 'tip' ? h.indexTip : which === 'palm' ? h.palmCenter : h.pinchPoint;
    return [p[0], p[1], p[2]];
  }

  async function pose(side, id) {
    const h = D(side);
    h.poseId = id;
    h.updateHandPose?.();
    await frames(3);
  }

  /** Close (or open) the hand gradually over ~8 frames, as fingers do: the pinch blends in. */
  async function pinch(side, on) {
    const h = D(side);
    if (h.poseId !== 'default') {
      h.poseId = 'default';
      h.updateHandPose?.();
    }
    const from = h.pinchValue ?? (on ? 0 : 1), to = on ? 1 : 0;
    for (let i = 1; i <= 8; i++) {
      h.setPinchValueImmediate?.(from + ((to - from) * i) / 8);
      await frames(1);
    }
    await frames(3);
    return H(side).pinching;
  }

  /**
   * Move a hand so that its feature `which` reaches `target` (world): steps of at most `step` m per
   * frame, as a real hand moves between frames; the feature's offset from the device hand is
   * measured again near the end (the filters lag a little).
   */
  async function moveTo(side, target, which = 'pinch', step = 0.015) {
    const h = D(side);
    for (let pass = 0; pass < 3; pass++) {
      await frames(2);
      const f = point(side, which);
      const off = [f[0] - h.position.x, f[1] - h.position.y, f[2] - h.position.z];
      const dest = [target[0] - off[0], target[1] - off[1], target[2] - off[2]];
      const from = [h.position.x, h.position.y, h.position.z];
      const dist = Math.hypot(dest[0] - from[0], dest[1] - from[1], dest[2] - from[2]);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        h.position.set(from[0] + ((dest[0] - from[0]) * i) / n, from[1] + ((dest[1] - from[1]) * i) / n, from[2] + ((dest[2] - from[2]) * i) / n);
        await frames(1);
      }
      if (dist < 0.004) break;
    }
    await frames(3);
    const f = point(side, which);
    return Math.hypot(f[0] - target[0], f[1] - target[1], f[2] - target[2]);
  }

  /**
   * Bring an open hand to where closing it pinches exactly at `target`, then close it (as a real
   * hand closes its fingers on the spot; `settle` frames still first). Returns the pinch point's
   * distance from the target.
   */
  async function pinchAt(side, target, step = 0.015, settle = 3) {
    const h = D(side);
    h.poseId = 'default';
    h.updateHandPose?.();
    // the offsets were measured at entry; the seated-height rig shift (V6 gap 2) moves every hand up since
    const up = w.__sys?.height?.shift ?? 0;
    const o = pinchOffset[side];
    const dest = [target[0] - o[0], target[1] - o[1] - up, target[2] - o[2]];
    const from = [h.position.x, h.position.y, h.position.z];
    const dist = Math.hypot(dest[0] - from[0], dest[1] - from[1], dest[2] - from[2]);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      h.position.set(from[0] + ((dest[0] - from[0]) * i) / n, from[1] + ((dest[1] - from[1]) * i) / n, from[2] + ((dest[2] - from[2]) * i) / n);
      await frames(1);
    }
    // the app's pinch point is filtered: it trails a moving hand for a few frames
    await frames(settle);
    // close the fingers while keeping the pinch point on the target, as a real pinch converges on a spot
    const curve = pinchCurve[side];
    for (let k = 1; k <= 8; k++) {
      const c = curve[k] ?? o;
      h.position.set(target[0] - c[0], target[1] - c[1] - up, target[2] - c[2]);
      h.setPinchValueImmediate?.(k / 8);
      await frames(1);
    }
    await frames(4);
    const f = point(side, 'pinch');
    return Math.hypot(f[0] - target[0], f[1] - target[1], f[2] - target[2]);
  }

  /** A hand's rest spot (out of the way). */
  async function rest(side) {
    await pinch(side, false);
    return moveTo(side, [side === 'left' ? -0.28 : 0.28, 0.9, -0.12], 'palm', 0.03);
  }

  // ---------- poking ----------

  /** Poke a world point on a surface facing `normal` with the index fingertip: from 6 cm out, through 1 cm. */
  async function pokeAt(p, n, side = 'right') {
    await pose(side, 'point');
    const at = (k) => [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k];
    await moveTo(side, at(0.07), 'tip', 0.03);
    await moveTo(side, at(0.015), 'tip', 0.01);
    await frames(4);
    await moveTo(side, at(-0.012), 'tip', 0.008);
    await frames(6);
    await moveTo(side, at(0.07), 'tip', 0.02);
    return true;
  }

  // the wrist menu (one-handed: fixed beside the clay; else palm-up on the left hand)
  function menu() {
    return sys().sculpt.menu;
  }

  function menuButton(id) {
    const m = menu();
    const b = m.buttons.find((x) => x.item.id === id && x.mesh.visible);
    if (!b) return null;
    const P = new (V())(), N = new (V())();
    b.mesh.getWorldPosition(P);
    b.mesh.getWorldDirection(N);
    return { p: P.toArray(), n: N.toArray(), enabled: b.item.enabled?.() ?? true };
  }

  function menuShown() {
    return menu().buttons.filter((b) => b.mesh.visible).map((b) => b.item.id);
  }

  /** Poke a menu button by id (a category opens its actions). */
  async function menuPress(id, side = 'right') {
    const b = menuButton(id);
    if (!b) return { ok: false, why: `menu button ${id} not shown (shown: ${menuShown().join(',')})` };
    await pokeAt(b.p, b.n, side);
    return { ok: true };
  }

  /** Every CanvasPanel instance (any system property, one level down). */
  function panels() {
    const out = [];
    const seen = new Set();
    const consider = (o) => {
      if (o && typeof o === 'object' && !seen.has(o) && typeof o.regionAtUv === 'function' && o.mesh) {
        seen.add(o);
        out.push(o);
      }
    };
    const all = w.__world.systems;
    for (const s of all instanceof Map ? all.values() : all ?? []) {
      for (const k of Object.keys(s)) {
        const v = s[k];
        consider(v);
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map)) for (const k2 of Object.keys(v)) if (k2 !== 'world') consider(v[k2]);
      }
    }
    return out;
  }

  /** A region (button) by id on a visible panel: its world centre and the panel's facing. */
  function region(id) {
    for (const pn of panels()) {
      if (!pn.mesh.visible) continue;
      const r = (pn.regions ?? []).find((x) => x.id === id);
      if (!r) continue;
      const u = (r.x + r.w / 2) / pn.px[0], v = 1 - (r.y + r.h / 2) / pn.px[1];
      const L = new (V())((u - 0.5) * pn.size[0], (v - 0.5) * pn.size[1], 0);
      pn.mesh.updateMatrixWorld(true);
      const P = pn.mesh.localToWorld(L.clone());
      const N = new (V())();
      pn.mesh.getWorldDirection(N);
      return { p: P.toArray(), n: N.toArray(), panel: pn.constructor.name };
    }
    return null;
  }

  /**
   * Visible panels that overlap on screen (the view the player sees: the left eye in XR). A keypad
   * over its own panel is a deliberate pop-up and is left out. Returns [{ a, b, share }], share =
   * overlap / the smaller panel's area.
   */
  function overlaps(min = 0.08) {
    const r = w.__world.renderer;
    const cam = r.xr.isPresenting ? r.xr.getCamera().cameras[0] ?? r.xr.getCamera() : w.__world.camera;
    const rects = [];
    for (const pn of panels()) {
      let vis = pn.mesh.visible;
      for (let o = pn.mesh.parent; o && vis; o = o.parent) vis = o.visible;
      if (!vis || 'upper' in pn) continue;
      pn.mesh.updateMatrixWorld(true);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const P = pn.mesh.localToWorld(new (V())((sx * pn.size[0]) / 2, (sy * pn.size[1]) / 2, 0));
        const Q = P.clone().applyMatrix4(cam.matrixWorldInverse);
        if (Q.z > 0) behind = true;
        P.project(cam);
        x0 = Math.min(x0, P.x); x1 = Math.max(x1, P.x); y0 = Math.min(y0, P.y); y1 = Math.max(y1, P.y);
      }
      if (behind || x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) continue;
      rects.push({ name: `${pn.px[0]}x${pn.px[1]}`, x0, y0, x1, y1 });
    }
    const out = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
        const share = (ix * iy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
        if (share > min) out.push({ a: a.name, b: b.name, share: Math.round(share * 100) / 100 });
      }
    return out;
  }

  function regions(filter) {
    const out = [];
    for (const pn of panels()) if (pn.mesh.visible) for (const r of pn.regions ?? []) if (!filter || r.id.includes(filter)) out.push(r.id);
    return out;
  }

  async function panelPress(id, side = 'right') {
    let r = region(id);
    for (let i = 0; i < 20 && !r; i++) {
      await frames(3);
      r = region(id);
    }
    if (!r) return { ok: false, why: `panel region ${id} not shown` };
    await pokeAt(r.p, r.n, side);
    return { ok: true, panel: r.panel };
  }

  // ---------- the clay ----------

  /** Clay volume (cm3), bounding size (cm), centre (world). */
  function clay() {
    const s = sys().sculpt;
    const root = s.view.root;
    const v = (s.client.last?.volume ?? 0) * 1e6 * root.scale.x ** 3;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position || !o.visible) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      if (!b || !isFinite(b.min.x)) return;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const q = o.localToWorld(new (V())(x, y, z));
        min = [Math.min(min[0], q.x), Math.min(min[1], q.y), Math.min(min[2], q.z)];
        max = [Math.max(max[0], q.x), Math.max(max[1], q.y), Math.max(max[2], q.z)];
      }
    });
    const c = s.clayCenterWorld(new (V())()).toArray();
    return { volume: Math.round(v), rawVolume: Math.round((s.client.last?.volume ?? 0) * 1e6), size: [0, 1, 2].map((i) => Math.round((max[i] - min[i]) * 1000) / 10), center: c, min, max, scale: root.scale.x, tool: s.tool?.id, pieces: s.client.last?.piecesMask ?? 0 };
  }

  /** A point on the clay surface toward a direction (from the clay centre), found by a ray. */
  function claySurface(dir) {
    const s = sys().sculpt;
    const c = s.clayCenterWorld(new (V())());
    const d = new (V())(dir[0], dir[1], dir[2]).normalize();
    const from = c.clone().addScaledVector(d, 0.4);
    const ray = new (sys().objects.ray.constructor)(from, d.clone().negate());
    const meshes = [];
    s.view.root.traverse((o) => o.isMesh && o.visible && meshes.push(o));
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? { p: hit.point.toArray(), n: d.toArray() } : null;
  }

  // ---------- objects and the table ----------

  function objectsState() {
    const o = sys().objects;
    return o.live.map((r) => ({ id: r.creation?.id ?? r.toyId, kind: r.kind, toy: r.toyId ?? null, p: r.mesh.position.toArray().map((x) => Math.round(x * 1000) / 1000), held: !!r.side, mode: r.mode }));
  }

  function surfaceInfo() {
    const s = w.__surface;
    return s ? { topY: s.topY, centerX: s.centerX, centerZ: s.centerZ, halfW: s.halfW, halfD: s.halfD, yaw: s.yaw } : null;
  }

  w.qa = {
    frames, fps, enterXR, point, pose, pinch, pinchAt, moveTo, rest, pokeAt, menuButton, menuShown, menuPress,
    panels, region, regions, panelPress, overlaps, clay, claySurface, objectsState, surfaceInfo, sleep,
  };
})();
