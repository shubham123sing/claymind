/*
 * More scripted flows (hands only): physics, Library / Play Kit, making a game (cards, pointing,
 * words, offline), playing, multiplayer. Loaded after driver.js and flows.js; adds to window.qaFlows.
 */
(() => {
  const qa = window.qa, w = window, F = w.qaFlows;
  const sys = () => w.__sys;
  const dev = () => w.IWER_DEVICE;
  const r3 = (x) => Math.round(x * 1000) / 1000;

  // ---------- objects: grab, carry, throw ----------

  function obj(id) {
    const r = sys().objects.byCreation(id) ?? sys().objects.byToy(id);
    return r ? { p: r.mesh.position.toArray(), r: r.radius, h: r.halfH ?? r.radius, held: !!r.side, mode: r.mode, mat: r.parts[0]?.mat?.id } : null;
  }

  /** Pinch an object on its top and keep holding it. */
  async function grab(id, side = 'right') {
    const o = obj(id);
    if (!o) return false;
    await qa.moveTo(side, [o.p[0], o.p[1] + o.r + 0.08, o.p[2]], 'pinch', 0.03);
    await qa.pinchAt(side, [o.p[0], o.p[1] + o.r * 0.5, o.p[2]]);
    await qa.frames(6);
    if (!obj(id)?.held && sys().objects.aim) {
      // a small piece in a flick game starts the assisted flick; lifting it (> 5 cm) picks it up instead
      const h = dev().hands[side];
      for (let i = 0; i < 8; i++) {
        h.position.y += 0.012;
        await qa.frames(1);
      }
      await qa.frames(4);
    }
    return obj(id)?.held ?? false;
  }

  /**
   * Move the hand's pinch point in a straight line. `speed` above 0.3 is metres per second (each frame's
   * step follows the real frame time, at most 11 cm: a bigger jump reads as a tracking glitch); below,
   * metres per frame. Opens the hand at `releaseAt` (0..1) of the way: a throw.
   */
  async function swing(side, to, speed, releaseAt = 2) {
    const h = dev().hands[side];
    const off = qa.point(side, 'pinch').map((v, i) => v - [h.position.x, h.position.y, h.position.z][i]);
    const dest = to.map((v, i) => v - off[i]);
    const start = [h.position.x, h.position.y, h.position.z];
    const total = Math.hypot(dest[0] - start[0], dest[1] - start[1], dest[2] - start[2]);
    let done = 0, last = performance.now(), released = false;
    while (done < total - 1e-6) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000) || 1 / 60;
      last = now;
      const step = speed > 0.3 ? Math.min(speed * dt, 0.11) : speed;
      done = Math.min(total, done + step);
      const k = total ? done / total : 1;
      h.position.set(start[0] + (dest[0] - start[0]) * k, start[1] + (dest[1] - start[1]) * k, start[2] + (dest[2] - start[2]) * k);
      if (!released && k >= releaseAt) {
        h.setPinchValueImmediate?.(0); // let go mid-swing: a throw
        released = true;
      }
      await qa.frames(1);
    }
    if (releaseAt <= 1 && !released) h.setPinchValueImmediate?.(0);
    await qa.frames(3);
  }

  async function waitFor(fn, frames = 200) {
    for (let i = 0; i < frames; i++) {
      const v = fn();
      if (v) return v;
      await qa.frames(1);
    }
    return fn();
  }

  // ---------- c. physics ----------

  /** The newest living creation is carried past the table edge and let go: it must fall and rest on the floor. */
  async function physicsPush() {
    const out = [];
    const id = sys().objects.liveCreationIds().at(-1);
    if (!id) return [{ name: 'push a piece off the table', pass: false, detail: 'no living creation' }];
    const surf = qa.surfaceInfo();
    const held = await grab(id);
    const o0 = obj(id);
    out.push({ name: 'grab the object (pinch)', pass: held, detail: `held ${held} at ${o0.p.map(r3).join(', ')}` });
    // carry it along the table and past its right edge, then let go
    const edgeX = surf.centerX + surf.halfW;
    await swing('right', [edgeX + 0.15, o0.p[1] + 0.06, o0.p[2]], 0.015);
    const carried = obj(id);
    // look where it will land (head turned right and down), so the video shows the fall
    const head = dev().quaternion, q0 = [head.x, head.y, head.z, head.w];
    const yaw = (-55 * Math.PI) / 360, pitch = (-40 * Math.PI) / 360;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    head.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    await qa.frames(4);
    await qa.pinch('right', false);
    await qa.rest('right');
    // where it lands (its lowest point), before the out-of-reach rescue floats it back beside the clay
    let minY = Infinity, landed = null;
    for (let i = 0; i < 240; i++) {
      await qa.frames(1);
      const o = obj(id);
      if (o && o.p[1] - o.h < minY) {
        minY = o.p[1] - o.h;
        landed = o.p;
      }
    }
    const o1 = obj(id);
    head.set(...q0);
    await qa.frames(4);
    out.push({ name: 'carried past the edge and let go: it falls and lands below the table', pass: !!landed && landed[0] > edgeX && minY > -0.03 && minY < surf.topY - 0.3, detail: landed ? `let go at ${carried.p.map(r3).join(', ')}; landed at ${landed.map(r3).join(', ')} (bottom ${r3(minY)} m; table top ${surf.topY} m, edge x ${r3(edgeX)}); 6 s later ${o1 ? `${o1.mode} at ${o1.p.map(r3).join(', ')}` : 'gone'}` : 'object gone' });
    out.push({ name: 'no tunnelling through the floor', pass: minY > -0.05, detail: `lowest bottom ${r3(minY)} m` });
    // reset: Place & Pin -> Remove from scene (the object last touched); Clear scene only takes Library copies
    const n0 = sys().objects.liveCreationIds().length;
    const m = await F.menuPath('place', 'remove');
    await qa.frames(30);
    const n1 = sys().objects.liveCreationIds().length;
    out.push({ name: 'reset (Place & Pin -> Remove from scene)', pass: m.ok && n1 === n0 - 1 && !sys().objects.byCreation(id), detail: `creations in the scene ${n0} -> ${n1}` });
    return out;
  }

  // ---------- d. Library and Play Kit ----------

  async function bringToLife() {
    const n0 = sys().objects.liveCreationIds().length;
    const surf = qa.surfaceInfo(), c = qa.clay().center;
    // the new object flies into the right hand about a second after the press (and the emulated palm
    // faces down, so it drops at once): straight after the poke the hand waits over a free spot on the table
    let ok = await F.openMenu();
    for (const id of ['physics', 'life']) {
      if (!qa.menuButton(id) && qa.menuButton('back')) await qa.menuPress('back');
      ok = ok && (await qa.menuPress(id)).ok;
      await qa.frames(4);
    }
    const spots = [0.2, -0.2, 0.28, -0.28];
    const x = spots[n0 % spots.length];
    await qa.moveTo('right', [c[0] + x, surf.topY + 0.16, c[2] + 0.02], 'palm', 0.05);
    await F.closeMenu();
    const m = { ok };
    await waitFor(() => sys().objects.liveCreationIds().length > n0, 400);
    await qa.frames(110); // the clay hands over, a fresh lump comes back
    return m.ok && sys().objects.liveCreationIds().length > n0 ? sys().objects.liveCreationIds().at(-1) : null;
  }

  async function libraryAndKit() {
    const out = [];
    const lib0 = sys().library.panel.items.length, kit0 = sys().playkit.kitItems().length;
    const shapes = [
      ['long', [[[1, 0, 0], [0.05, 0, 0]], [[-1, 0, 0], [-0.04, 0, 0]]]],
      ['tall', [[[0, 1, 0], [0, 0.05, 0]]]],
      ['flat', 'carve'],
    ];
    let added = 0;
    const made = [];
    await F.menuPath('make', 'shape');
    for (const [label, strokes] of shapes) {
      if (strokes === 'carve') {
        await F.menuPath('make', 'carve');
        for (const d of [[0, 1, 0], [0.4, 1, 0], [-0.4, 1, 0], [0, 1, 0.4]]) await F.stroke(d, [0, -0.02, 0]);
        await F.menuPath('make', 'shape');
      } else for (const [d, mv] of strokes) await F.stroke(d, mv);
      const n0 = sys().objects.liveCreationIds().length;
      let id = await bringToLife();
      // a slow bake: wait for it rather than pressing again (a second press makes a second creation)
      if (!id && (await waitFor(() => sys().objects.liveCreationIds().length > n0, 600))) id = sys().objects.liveCreationIds().at(-1);
      made.push(`${label}: ${id ? 'made' : 'not made'}`);
      if (!id) continue;
      if (label === 'long') {
        const m = await F.menuPath('lib', 'libadd');
        await waitFor(() => sys().library.panel.items.length > lib0, 200);
        out.push({ name: 'add one creation to the Library (Library -> Add)', pass: m.ok && sys().library.panel.items.length === lib0 + 1, detail: `Library ${lib0} -> ${sys().library.panel.items.length}` });
      }
      const k0 = sys().playkit.kitItems().length;
      await F.menuPath('kit', 'kitadd');
      if (await waitFor(() => sys().playkit.kitItems().length > k0, 200)) added++;
      else made.push(`${label}: not added to the kit`);
    }
    const kit1 = sys().playkit.kitItems();
    const sizes = kit1.map((k) => k.stats.sizeCm.map((v) => Math.round(v)).join('x'));
    out.push({
      name: 'add three different creations to the Play Kit (Play Kit -> Add)',
      pass: kit1.length === kit0 + 3 && added === 3 && new Set(sizes).size === sizes.length,
      detail: `Play Kit ${kit0} -> ${kit1.length}: ${kit1.map((k, i) => `${k.name} (${k.role}, ${sizes[i]} cm)`).join('; ')} [${made.join(', ')}]`,
    });
    return out;
  }

  // ---------- e. making a game ----------

  /** Play Kit -> Open Play Kit (the menu item toggles: pressed again if the press closed it). */
  async function openPlayKit() {
    for (let i = 0; i < 2 && !qa.region('tab:games'); i++) await F.menuPath('kit', 'playkit');
    return !!qa.region('tab:games');
  }

  async function openGameAgent() {
    const ga = sys().gameAgent;
    if (!ga.panel.mesh.visible) {
      await openPlayKit();
      await qa.panelPress('tab:games');
      await qa.panelPress('games:agent');
    }
    await waitFor(() => ga.panel.mesh.visible && ga.panel.online !== null, 600);
    return ga.panel.online;
  }

  async function waitAnswer() {
    const ga = sys().gameAgent;
    await waitFor(() => ['preview', 'message'].includes(ga.panel.view), 3000);
    const a = ga.panel.answer;
    return { view: ga.panel.view, name: a?.preview.name, path: a?.path, note: a?.note, physics: a?.physics, message: ga.panel.message };
  }

  async function backToGames() {
    const ga = sys().gameAgent;
    for (let i = 0; i < 4 && ga.panel.view !== 'games'; i++) if (!(await qa.panelPress('back')).ok) break;
  }

  async function gameFromCard(card = 'Bowling') {
    const online = await openGameAgent();
    await backToGames();
    const p = await qa.panelPress(`game:${card}`);
    const a = await waitAnswer();
    return [{ name: `make a game from a card ("${card}", backend ${online ? 'on' : 'off'})`, pass: p.ok && online === true && a.view === 'preview' && !!a.name, detail: `${a.view}: ${a.name ?? a.message} (${a.path ?? ''}) ${a.note ?? ''} ${a.physics ? `physics ${a.physics.ok ? 'ok' : a.physics.problems[0]}` : ''}` }];
  }

  /** Point at a toy with an index finger: the ray from the fingertip, held about 0.7 s. */
  async function pointAt(toyId, side = 'left') {
    const o = obj(toyId);
    if (!o) return false;
    // the finger turned to point straight down, the fingertip 20 cm above the toy: no other toy is in the way
    const hd = dev().hands[side], H = w.__input.hands[side];
    hd.quaternion.set(0, 0, 0, 1);
    await qa.pose(side, 'point');
    await qa.frames(6);
    const Vec = w.__world.camera.position.constructor, Quat = w.__world.camera.quaternion.constructor;
    const u0 = new Vec(...H.indexTip.map((v, i) => v - H.palmCenter[i])).normalize();
    const q = new Quat().setFromUnitVectors(u0, new Vec(0, -1, 0));
    hd.quaternion.set(q.x, q.y, q.z, q.w);
    await qa.frames(6);
    await qa.moveTo(side, [o.p[0], o.p[1] + o.r + 0.2, o.p[2]], 'tip', 0.03);
    await qa.frames(30);
    return true;
  }

  async function typeOnKeypad(text) {
    for (const ch of text.toUpperCase()) {
      const r = await qa.panelPress(ch === ' ' ? 'space' : `k:${ch}`);
      if (!r.ok) return r;
    }
    return qa.panelPress('done');
  }

  async function describeGame() {
    const out = [];
    const pk = sys().playkit, ga = sys().gameAgent;
    if (ga.panel.mesh.visible) await qa.panelPress('close');
    // two toys on the table: Play Kit -> Kit -> pick a toy -> Place ("Open Play Kit" toggles: open it if it closed)
    const kitOpened = await openPlayKit();
    const kitOpens = kitOpened ? 1 : 0;
    await qa.panelPress('tab:kit');
    for (const k of pk.kitItems().slice(0, 2)) {
      await qa.panelPress(`k:${k.id}`);
      await qa.panelPress('kit:place');
      await qa.frames(30);
    }
    const toys = pk.pieces.map((p) => p.toyId);
    out.push({ name: 'place two kit toys on the table (Kit -> Place)', pass: toys.length >= 2, detail: `${toys.length} toys on the table: ${toys.map((t) => sys().playkit.itemName(`toy:${t}`)).join(', ')}${kitOpens ? '' : ' (Play Kit did not open)'}` });
    if (qa.region('close')) await qa.panelPress('close');
    await openGameAgent();
    await backToGames();
    await qa.panelPress('game:describe');
    const inDescribe = await waitFor(() => ga.panel.view === 'describe', 100);
    out.push({ name: 'open "Show me with my hands" (Describe view)', pass: !!inDescribe, detail: `view ${ga.panel.view}` });
    if (!inDescribe) return out;
    // point at a toy with the left hand, press the chip with the right within 2 s
    for (const [toy, chip] of [[toys[0], 'chip:ball'], [toys[1], 'chip:target']]) {
      if (!toy) continue;
      await pointAt(toy, 'left');
      await qa.panelPress(chip);
      await qa.frames(10);
      out.push({ name: `point at a toy + "${chip.slice(5)}" chip`, pass: ga.panel.hintOk && /Got it/.test(ga.panel.hint), detail: ga.panel.hint });
      dev().hands.left.quaternion.set(0, 0, 0, 1);
      await qa.pose('left', 'default');
      await qa.rest('left');
    }
    // and in words, on the pinch keypad
    const t = await qa.panelPress('describe:type');
    const typed = t.ok ? await typeOnKeypad('knock them down') : t;
    await qa.frames(10);
    out.push({ name: 'describe in words (keypad: "knock them down")', pass: typed.ok && ga.panel.understood.some((l) => /knock them down/i.test(l)), detail: ga.panel.understood.join(' | ') });
    await qa.panelPress('describe:make');
    let presses = 1;
    if (!(await waitFor(() => ga.panel.view !== 'describe', 60))) {
      await qa.panelPress('describe:make');
      presses++;
    }
    const a = await waitAnswer();
    out.push({ name: 'Make it: a game from what was shown and said', pass: a.view === 'preview' && !!a.name && presses === 1, detail: `${a.view}: ${a.name ?? a.message} (${a.path ?? ''}); uses ${ga.panel.uses.join(', ')}${presses > 1 ? `; needed ${presses} presses of Make it` : ''}` });
    return out;
  }

  /** The backend is unreachable (the test blocks it): one plain line, the built-in games stay. */
  async function gameOffline() {
    const ga = sys().gameAgent;
    if (ga.panel.mesh.visible) await qa.panelPress('close');
    await qa.frames(10);
    await openPlayKit();
    await qa.panelPress('tab:games');
    await qa.panelPress('games:agent');
    await waitFor(() => ga.panel.mesh.visible, 300);
    await backToGames();
    // V6: a card still gives its built-in game (no waiting on the backend); the panel says the agent is waking / offline
    const p = await qa.panelPress('game:Bowling');
    const a = await waitAnswer();
    await waitFor(() => ga.panel.online !== true, 300);
    const status = ga.panel.online;
    if (ga.panel.mesh.visible) await qa.panelPress('close');
    return [{ name: 'backend off: a game card still gives its built-in game', pass: p.ok && a.view === 'preview' && !!a.name && status !== true, detail: `${a.view}: ${a.name ?? a.message} (${a.path ?? ''}) ${a.note ?? ''}; agent shown as ${status === null ? 'waking up' : status ? 'online' : 'offline'}` }];
  }

  // ---------- f. playing ----------

  /** What the game counts as scoring: the score, blocks down, balls in (summed). */
  function scoreOf(lines) {
    return [...lines.join(' | ').matchAll(/(?:Score|Player \d|down|in): (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  }

  function hud() {
    const h = sys().playkit.hud;
    return { lines: [...(h.lines ?? [])], message: h.message ?? '', rules: (h.rules ?? []).length, over: !!h.over };
  }

  /** Throw a piece at `aim`: straight and fast at things to knock over, a lob (up and over) into a cup. */
  async function throwAt(ball, aim, lob = false, speed = 2.5) {
    if (!(await grab(ball))) return false;
    const o = obj(ball);
    await swing('right', [o.p[0], o.p[1] + 0.1, o.p[2] + 0.1], 0.015);
    if (lob) {
      // a 45-degree lob into the cup: the speed from the distance and the drop, the hand moving that way at that
      // speed and letting go at the release point (the game takes the throw from the hand's movement)
      const R = obj(ball).p; // release point: where the ball is now (lifted)
      const dx = aim[0] - R[0], dz = aim[2] - R[2], d = Math.hypot(dx, dz);
      const dy = aim[1] + 0.06 - R[1], th = Math.PI / 4, g = 9.81;
      const s = Math.sqrt((g * d * d) / (2 * Math.cos(th) ** 2 * Math.max(0.02, d * Math.tan(th) - dy))) * speed;
      const u = [(Math.cos(th) * dx) / d, Math.sin(th), (Math.cos(th) * dz) / d];
      // draw back along the throw, pause (the game measures the last 150 ms of the hand), then swing through
      await swing('right', R.map((v, i) => v - u[i] * 0.2), 0.012);
      await qa.sleep(250);
      await swing('right', R.map((v, i) => v + u[i] * 0.1), s, 0.2 / 0.3);
    } else await swing('right', [aim[0], aim[1] + 0.05, aim[2]], speed, 0.6);
    await qa.rest('right');
    return true;
  }

  async function playGame() {
    const out = [];
    const ga = sys().gameAgent, pk = sys().playkit;
    if (ga.panel.mesh.visible && ga.panel.view === 'preview') await qa.panelPress('preview:play');
    else {
      if (ga.panel.mesh.visible) await qa.panelPress('close');
      await startKnockDown();
    }
    await waitFor(() => pk.playMode === 'play', 300);
    await qa.frames(60);
    const h0 = hud();
    out.push({ name: 'the game starts with its rules shown', pass: pk.playMode === 'play' && h0.rules > 0, detail: `${pk.gameName}: ${h0.lines.join(' | ')}; ${h0.rules} rule lines` });
    const spec = pk.spec;
    const movers = new Set((spec?.roles ?? []).filter((r) => !r.pinned && (r.tags.includes('launcher') || ['ball', 'marble', 'coin', 'disc'].includes(r.fallback))).map((r) => r.id));
    const balls = pk.pieces.filter((p) => movers.has(p.role)).map((p) => p.toyId);
    const targets = pk.pieces.filter((p) => !movers.has(p.role)).map((p) => obj(p.toyId)?.p).filter(Boolean);
    const aim = targets.length ? [0, 1, 2].map((i) => targets.reduce((s, t) => s + t[i], 0) / targets.length) : [0, 0.78, -0.55];
    let thrown = 0;
    // cups (containers) need a lob; try a few strengths, as a player would
    const lob = (spec?.roles ?? []).some((r) => r.tags.includes('container'));
    // lob: a factor on the computed speed (a real player corrects after each throw too)
    const speeds = lob ? [1.3, 1.2, 1.4, 1.25, 1.35] : [2.5, 2.8, 2.2];
    for (const [k, b] of balls.slice(0, speeds.length).entries()) {
      if (!(await throwAt(b, aim, lob, speeds[k]))) continue;
      thrown++;
      await qa.frames(150);
      if (scoreOf(hud().lines) > scoreOf(h0.lines)) break;
    }
    const h1 = hud();
    out.push({ name: 'throw at the targets by hand: it scores', pass: thrown > 0 && scoreOf(h1.lines) > scoreOf(h0.lines), detail: `${thrown} throw(s) of ${balls.length} pieces; before: ${h0.lines.join(' | ')}; after: ${h1.lines.join(' | ')} ${h1.message ? `"${h1.message}"` : ''}` });
    const r = await qa.panelPress('hud:reset');
    await qa.frames(80);
    const h2 = hud();
    out.push({ name: 'reset the game (HUD Reset)', pass: r.ok && h2.lines.join() === h0.lines.join(), detail: `after reset: ${h2.lines.join(' | ')}` });
    return out;
  }

  // ---------- g. multiplayer ----------

  async function roomCreate() {
    await F.menuPath('mp', 'room');
    const p = await qa.panelPress('create');
    const code = await waitFor(() => (w.__room.connected ? w.__room.code : null), 600);
    if (qa.region('close')) await qa.panelPress('close');
    return { pass: p.ok && !!code, code, detail: `room ${code}` };
  }

  async function roomJoin(code) {
    await F.menuPath('mp', 'room');
    const p = await qa.panelPress('join');
    const t = p.ok ? await typeOnKeypad(code) : p;
    const ok = await waitFor(() => w.__room.connected && w.__room.players.length >= 2, 600);
    if (qa.region('close')) await qa.panelPress('close');
    return { pass: t.ok && !!ok, detail: `players: ${w.__room.players.map((x) => x.name).join(', ')}` };
  }

  async function startKnockDown() {
    await openPlayKit();
    await qa.panelPress('tab:games');
    await qa.panelPress('g:knock-down');
    const p = await qa.panelPress('setup:play');
    await waitFor(() => sys().playkit.playMode === 'play', 300);
    await qa.frames(60);
    return p.ok && sys().playkit.playMode === 'play';
  }

  async function throwOne() {
    const pk = sys().playkit;
    const ball = pk.pieces.find((p) => p.role === 'ball')?.toyId;
    const targets = pk.pieces.filter((p) => p.role === 'block').map((p) => obj(p.toyId)?.p).filter(Boolean);
    if (!ball || !targets.length) return false;
    const aim = [0, 1, 2].map((i) => targets.reduce((s, t) => s + t[i], 0) / targets.length);
    const ok = await throwAt(ball, aim);
    await qa.frames(180);
    return ok;
  }

  Object.assign(F, { throwAt, scoreOf, openPlayKit, obj, grab, swing, waitFor, physicsPush, bringToLife, libraryAndKit, openGameAgent, waitAnswer, backToGames, gameFromCard, pointAt, typeOnKeypad, describeGame, gameOffline, hud, playGame, roomCreate, roomJoin, startKnockDown, throwOne });
})();
