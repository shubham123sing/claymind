/*
 * More scripted flows (hands only): physics, Library / Play Kit, making a game (cards, pointing,
 * words, offline), playing, multiplayer. Loaded after driver.js and flows.js; adds to window.qaFlows.
 */
(() => {
  const qa = window.qa, w = window, F = w.qaFlows;
  const sys = () => w.__sys;
  const dev = () => w.IWER_DEVICE;
  const input = () => w.__input;
  const V = () => w.__world.camera.position.constructor; // the app's Vector3
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
    const m = await F.menuPath('physics', 'remove');
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
    let rel = null;
    const off = w.__bus.on('toy:released', (e) => (rel = e));
    const b0 = obj(ball)?.p;
    const ok = await throwAt(ball, aim);
    await qa.frames(180);
    off?.();
    console.info(`[throwOne] ball ${b0?.map((v) => v.toFixed(2))} -> ${obj(ball)?.p.map((v) => v.toFixed(2))}, aim ${aim.map((v) => v.toFixed(2))}, release ${JSON.stringify(rel)}, fps ${w.__quality.fps}`);
    return ok;
  }

  // ---------- h. first five minutes (V6, 4.1): the card on first launch, hands only ----------

  /** part 1: to the agent's preview · 2: explain, play, the success card · 3: Help again, Skip (a screenshot after each). */
  async function firstFive(part = 1) {
    const out = [], c = sys().coach, ga = sys().gameAgent, pk = sys().playkit;
    if (part === 2) return firstFivePlay(out, c, ga, pk);
    if (part === 3) return firstFiveHelp(out, c, pk);
    w.__f5t0 = performance.now();
    await waitFor(() => c.active, 300);
    const top = sys().sculpt.menu.top.map((i) => i.id).join(', ');
    out.push({ name: 'first launch: the card shows step 1 (pinch and pull); the palm menu has 6 categories + 2 small icons', pass: c.active && c.panel.step === 0 && c.panel.mesh.visible, detail: `step ${c.panel.step + 1}; menu: ${top}` });
    // 1. pinch the clay and pull
    await F.stroke([1, 0.3, 0.3], [0.04, 0.01, 0]);
    await waitFor(() => c.panel.step === 1, 60);
    out.push({ name: '1. pinch and pull the clay: the card moves on', pass: c.panel.step === 1, detail: `step ${c.panel.step + 1}` });
    // 2. one tap on the card: Bring to life
    const n0 = sys().objects.liveCreationIds().length;
    const life = await qa.panelPress('life');
    await waitFor(() => c.panel.step === 2, 400);
    out.push({ name: '2. one tap on "Bring to life" (on the card): it drops', pass: life.ok && c.panel.step === 2 && sys().objects.liveCreationIds().length > n0, detail: `creations ${n0} -> ${sys().objects.liveCreationIds().length}` });
    await qa.frames(60);
    // 3. one tap: Make it a game: the agent looks, says what it saw and why, the Referee tests it
    // every status the panel shows, sampled from before the press (the "looking" moment is short)
    const seen = new Set();
    const watch = setInterval(() => ga.panel.view === 'thinking' && seen.add(ga.panel.status), 30);
    const g = await qa.panelPress('game');
    await waitFor(() => ga.panel.view === 'preview', 900);
    clearInterval(watch);
    const looked = [...seen].some((x) => /looking/.test(x));
    const a = ga.panel.answer, look = ga.panel.look;
    out.push({
      name: '3. one tap on "Make it a game": "looking at your creation", then what it saw, the rule and why, the Referee badge',
      pass: g.ok && !!looked && ga.panel.view === 'preview' && !!look && !!a?.physics?.ok && ga.panel.uses.some((u) => u.includes('your ')),
      detail: look ? `shown: ${[...seen].join(' -> ')} | ${a.preview.name} | saw: ${look.seen.join('; ')} | rule: ${look.rule} | why: ${look.why} | Referee: ${a.physics?.ok ? 'passed' : a.physics?.problems?.[0]} | uses: ${ga.panel.uses.join(', ')}` : `view ${ga.panel.view}; ${ga.panel.message}`,
    });
    return out;
  }

  async function firstFivePlay(out, c, ga, pk) {
    const ex = await qa.panelPress('preview:explain');
    await qa.frames(10);
    out.push({ name: 'explain mode: the rules in plain words', pass: ex.ok && ga.panel.view === 'explain' && ga.panel.explained.length >= 3, detail: ga.panel.explained.join(' / ') });
    await qa.panelPress('preview:play');
    await waitFor(() => pk.playMode === 'play' && c.panel.step === 3, 300);
    await qa.frames(60);
    out.push({ name: 'Play from the explanation: the game starts with the creation on the table', pass: pk.playMode === 'play' && c.panel.step === 3, detail: `${pk.gameName}: ${hud().lines.join(' | ')}` });
    // 4. play: throw the balls until the game ends; then the success moment
    const spec = pk.spec;
    const movers = new Set((spec?.roles ?? []).filter((r) => !r.pinned && (r.tags.includes('launcher') || ['ball', 'marble', 'coin', 'disc'].includes(r.fallback))).map((r) => r.id));
    const balls = pk.pieces.filter((p) => movers.has(p.role)).map((p) => p.toyId);
    const targets = pk.pieces.filter((p) => !movers.has(p.role)).map((p) => obj(p.toyId)?.p).filter(Boolean);
    const aim = targets.length ? [0, 1, 2].map((i) => targets.reduce((sum, t) => sum + t[i], 0) / targets.length) : [0, 0.78, -0.55];
    const lob = (spec?.roles ?? []).some((r) => r.tags.includes('container'));
    let thrown = 0;
    for (const b of balls) {
      if (c.panel.doneText) break;
      if (await throwAt(b, aim, lob, lob ? 1.3 : 2.5)) thrown++;
      await qa.frames(150);
    }
    await waitFor(() => !!c.panel.doneText, 300);
    const sec = Math.round((performance.now() - w.__f5t0) / 1000);
    out.push({ name: '4. play by hand; the game ends: the success card and where to go next', pass: !!c.panel.doneText && c.panel.mesh.visible, detail: `${thrown} throw(s); HUD: ${hud().lines.join(' | ')} "${hud().message}"; card: "${c.panel.doneText}" (scripted run ${sec} s)` });
    return out;
  }

  async function firstFiveHelp(out, c, pk) {
    // OK, end the game; then Help (?) shows the card again and Skip closes it
    await qa.panelPress('close');
    if (qa.region('hud:end')) await qa.panelPress('hud:end');
    await waitFor(() => pk.playMode === 'off', 200);
    const h = await F.menuPath('help');
    await qa.frames(10);
    const again = c.active && c.panel.step === 0;
    const sk = await qa.panelPress('skip');
    await qa.frames(10);
    out.push({ name: 'Help (?) in the palm menu shows it again; Skip closes it', pass: h.ok && again && sk.ok && !c.active && !c.panel.mesh.visible, detail: `help ${h.ok}, restarted ${again}, skipped ${sk.ok}` });
    // tidy for the next steps: touch the first creation, then Bring to life -> Remove from scene, as a player would
    const n = sys().objects.liveCreationIds().length, first = sys().objects.liveCreationIds()[0];
    if (first && (await grab(first))) {
      await qa.pinch('right', false);
      await qa.rest('right');
      await qa.frames(30);
    }
    await F.menuPath('physics', 'remove');
    await waitFor(() => sys().objects.liveCreationIds().length < n, 120);
    await qa.frames(30);
    return out;
  }

  // ---------- r. robustness (V6 section 6): bad tracking must not break anything ----------

  /** Page errors from here on (uncaught errors and rejections). */
  function watchErrors() {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message ?? e.reason ?? e));
    addEventListener('error', onErr);
    addEventListener('unhandledrejection', onErr);
    return { errs, stop: () => (removeEventListener('error', onErr), removeEventListener('unhandledrejection', onErr)) };
  }

  const noiseOff = () => Object.assign(w.__handNoise, { jitter: 0, jointJitter: 0, dropEvery: [0, 0], dropFor: [0, 0] });
  const held = () => sys().objects.heldItems().length;

  async function robust() {
    const out = [], watch = watchErrors(), N = w.__handNoise;
    noiseOff();
    // a game still running from step f: end it (the HUD's End button), as step g does; sculpting is paused in a game
    if (sys().playkit.playMode !== 'off' && qa.region('hud:end')) await qa.panelPress('hud:end');
    await waitFor(() => sys().playkit.playMode === 'off', 200);
    let id = sys().objects.liveCreationIds().at(-1) ?? (await bringToLife());
    const n0 = sys().objects.liveCreationIds().length;

    // 1. a short loss (about 50 ms) while holding: the object stays in the hand
    let g = await grab(id);
    N.dropUntil.right = performance.now() + 50;
    await qa.frames(20);
    const kept = obj(id)?.held ?? false;
    await qa.pinch('right', false);
    await qa.frames(20);
    out.push({ name: 'r1. hand lost for 50 ms while holding: still held (no drop)', pass: g && kept, detail: `grabbed ${g}, held after ${kept}` });

    // 2. the hand vanishes mid-grab (0.4 s) and the fingers open meanwhile: let go, the hand is free, nothing lost
    g = await grab(id);
    N.dropUntil.right = performance.now() + 400;
    await qa.frames(4);
    await qa.pinch('right', false);
    await waitFor(() => performance.now() > N.dropUntil.right, 200);
    await qa.frames(40);
    const st = { held: held(), claim: w.__input.claims.right, tracked: w.__input.hands.right.tracked, exists: !!obj(id) };
    const again = await grab(id);
    // put it down beside the clay (not on it), as a player tidies up before sculpting again
    const cl = qa.clay().center, s0 = qa.surfaceInfo();
    if (again) await qa.moveTo('right', [cl[0] + 0.24, s0.topY + 0.12, cl[2] + 0.05], 'pinch', 0.03);
    await qa.pinch('right', false);
    await qa.rest('right');
    await qa.frames(40);
    out.push({ name: 'r2. hand vanishes mid-grab (0.4 s): released, hand free, object kept, grabs again', pass: g && st.held === 0 && !st.claim && st.tracked && st.exists && again && held() === 0, detail: `${JSON.stringify(st)}, grabbed again ${again}` });

    // 3. two hands crossing over the clay (one pinching): no stuck claim, no stray tool action
    const c = qa.clay().center, v0 = qa.clay().volume;
    await Promise.all([qa.moveTo('left', [c[0] - 0.12, c[1] + 0.14, c[2] + 0.04], 'tip', 0.03), qa.moveTo('right', [c[0] + 0.12, c[1] + 0.14, c[2] + 0.04], 'tip', 0.03)]);
    await qa.pinch('left', true);
    const L = dev().hands.left, R = dev().hands.right;
    for (let i = 0; i < 24; i++) {
      L.position.x += 0.01;
      R.position.x -= 0.01;
      await qa.frames(1);
    }
    await qa.pinch('left', false);
    await Promise.all([qa.rest('left'), qa.rest('right')]);
    await qa.frames(20);
    const cross = { claims: [w.__input.claims.left, w.__input.claims.right], held: held(), volume: [v0, qa.clay().volume] };
    out.push({ name: 'r3. hands crossing over the clay (one pinching in the air): nothing stuck, the clay unchanged', pass: !cross.claims[0] && !cross.claims[1] && cross.held === 0 && Math.abs(cross.volume[1] - v0) < 1, detail: JSON.stringify(cross) });

    // tidy as a player would: creations left on or against the clay by earlier steps are carried aside by hand
    for (const cid of sys().objects.liveCreationIds()) {
      const o = obj(cid), cc0 = qa.clay().center;
      if (!o || Math.hypot(o.p[0] - cc0[0], o.p[2] - cc0[2]) > 0.16 || !(await grab(cid))) continue;
      await qa.moveTo('right', [cc0[0] + 0.26, qa.surfaceInfo().topY + 0.12, cc0[2] + 0.08], 'pinch', 0.03);
      await qa.pinch('right', false);
      await qa.rest('right');
      await qa.frames(40);
    }

    // 4. rapid tool switching: eight pokes in a row on the Make tools, then the last tool works
    await F.openMenu();
    if (!qa.menuButton('add') && qa.menuButton('back')) await qa.menuPress('back');
    await qa.menuPress('make');
    await qa.frames(4);
    const seq = ['add', 'carve', 'smooth', 'shape', 'add', 'carve', 'smooth', 'add'];
    let pressed = 0;
    for (const t of seq) pressed += (await qa.menuPress(t)).ok ? 1 : 0;
    await F.closeMenu();
    const tool = qa.clay().tool, va = qa.clay().volume;
    const cc = qa.clay().center, near = qa.objectsState().filter((o) => Math.hypot(o.p[0] - cc[0], o.p[2] - cc[2]) < 0.3).map((o) => `${o.kind}:${o.mode}@${o.p.map((v) => v.toFixed(2)).join(',')}`);
    let heldMid = null;
    const probe = setInterval(() => (heldMid ??= held() ? JSON.stringify(sys().objects.heldItems()) : null), 30);
    const surf = qa.claySurface([1, 0.3, 0.5]);
    await F.stroke([1, 0.3, 0.5], [0.04, 0.01, 0.02]);
    clearInterval(probe);
    console.info(`[r4] near clay: ${near.join(' | ')}; held during stroke: ${heldMid}; surface ${JSON.stringify(surf)}; suspended ${sys().sculpt.suspended}; claims ${JSON.stringify(w.__input.claims)}`);
    out.push({ name: 'r4. rapid tool switching (8 pokes), then the last tool (Add) works', pass: pressed === seq.length && tool === 'add' && qa.clay().volume > va, detail: `${pressed}/${seq.length} pokes, tool ${tool}, volume ${va} -> ${qa.clay().volume}` });

    // 5. noisy hands (1 cm whole-hand jitter, 2 mm per joint, a 0.2-0.5 s dropout every 2.5-5 s): sculpt, carry, drop
    Object.assign(N, { jitter: 0.01, jointJitter: 0.002, dropEvery: [2500, 5000], dropFor: [200, 500] });
    const d0 = N.drops, vn = qa.clay().volume;
    // as a player would: a missed press (the hand vanished mid-poke) is tried again, up to 3 times
    let m = { ok: false }, tries = 0;
    while (tries < 3 && !(m.ok && qa.clay().tool === 'add')) {
      tries++;
      m = await F.menuPath('make', 'add');
    }
    for (let k = 0; k < 2 && qa.clay().volume <= vn; k++) await F.stroke([1, 0.3, 0.5], [0.04, 0.01, 0.02]);
    const vn1 = qa.clay().volume;
    id = sys().objects.liveCreationIds().at(-1);
    g = await grab(id);
    if (g) await swing('right', [c[0] + 0.15, c[1] + 0.1, c[2] + 0.05], 0.01, 1);
    await qa.pinch('right', false);
    await qa.frames(60);
    noiseOff();
    await Promise.all([qa.rest('left'), qa.rest('right')]);
    await qa.frames(40);
    const after = { menu: m.ok, tries, volume: [vn, vn1], grabbed: g, held: held(), creations: [n0, sys().objects.liveCreationIds().length], drops: N.drops - d0 };
    out.push({ name: 'r5. noisy hands (1 cm jitter + dropouts): sculpt, grab and drop still work, nothing held or lost', pass: after.held === 0 && after.creations[1] >= n0 && vn1 > vn, detail: JSON.stringify(after) });

    watch.stop();
    out.push({ name: 'r6. no uncaught errors during the robustness steps', pass: watch.errs.length === 0, detail: watch.errs.slice(0, 3).join(' | ') || 'none' });
    return out;
  }

  // ---------- x. V6 Stage D: today's challenge, Settings -> About (build id), Large text ----------

  async function extras() {
    const out = [], d = sys().daily, set = sys().settings;
    if (sys().playkit.playMode !== 'off' && qa.region('hud:end')) await qa.panelPress('hud:end');
    await waitFor(() => sys().playkit.playMode === 'off', 200);
    const toasts = [];
    const off = w.__bus.on('ui:toast', (e) => toasts.push(e.text));

    // 1. Play -> Today's challenge says the goal
    const m = await F.menuPath('kit', 'daily');
    await qa.frames(10);
    out.push({ name: "x1. Play -> Today's challenge says today's goal", pass: m.ok && toasts.some((t) => t.startsWith("Today's challenge")), detail: `${d.state.day}: "${toasts.at(-1) ?? ''}"` });

    // 2. done by hand: the day's goal set to the throw one for the test (the date picks another on most days), then a hard throw
    // (already done earlier in this run, e.g. a won game in step f: noted, then cleared for the throw)
    const before = d.line();
    d.state = { day: d.state.day, done: false, streak: 0, lastDone: null };
    d.challenge = { id: 'throwHard', text: 'Throw a creation of yours, hard' };
    const id = sys().objects.liveCreationIds().at(-1) ?? (await bringToLife());
    let thrown = false, rel = null;
    const offR = w.__bus.on('body:released', (e) => (rel = Math.hypot(...e.v).toFixed(2)));
    if (await grab(id)) {
      const o = obj(id);
      await swing('right', [o.p[0], o.p[1] + 0.08, o.p[2] + 0.12], 0.015);
      await swing('right', [o.p[0] + 0.05, o.p[1] + 0.25, o.p[2] - 0.5], 5, 0.5);
      await qa.rest('right');
      thrown = true;
    }
    await waitFor(() => d.state.done, 120);
    offR?.();
    out.push({ name: 'x2. a hard throw completes the challenge: a result card (toast) and a streak of 1', pass: thrown && d.state.done && d.state.streak === 1 && toasts.some((t) => t.startsWith('Daily challenge done')), detail: `before: "${before}"; thrown ${thrown} at ${rel} m/s (fps ${w.__quality.fps}), ${JSON.stringify(d.state)}, "${toasts.at(-1) ?? ''}"` });
    await qa.frames(60);
    if (obj(id)) {
      await F.menuPath('physics', 'recenter');
      await qa.frames(20);
    }

    // 3. Settings -> About: the short help, today's challenge and the build id
    await F.menuPath('settings');
    await qa.frames(10);
    const a = await qa.panelPress('about');
    await qa.frames(10);
    const about = set.panel.page === 'about' && !!qa.region('back') && set.panel.daily.includes('done');
    out.push({ name: 'x3. Settings -> About shows the help lines, the challenge (done) and the build id', pass: a.ok && about, detail: `page ${set.panel.page}, "${set.panel.daily}"` });
    await qa.panelPress('back');
    await qa.frames(10);

    // 4. Large text: panels 20% bigger, still none overlapping
    const s0 = set.panel.mesh.scale.x;
    const t = await qa.panelPress('largeText');
    await qa.frames(10);
    const s1 = set.panel.mesh.scale.x, ov = qa.overlaps();
    out.push({ name: 'x4. Large text: the panel grows 1.25 -> 1.5, no overlapping panels', pass: t.ok && Math.abs(s1 / s0 - 1.2) < 0.01 && ov.length === 0, detail: `scale ${s0.toFixed(2)} -> ${s1.toFixed(2)}, overlaps ${JSON.stringify(ov)}` });
    await qa.panelPress('largeText');
    await qa.frames(10);
    await qa.panelPress('close');
    await qa.frames(10);
    off?.();
    return out;
  }

  // ---------- m. movable panels (V6 gap 1): pinch a panel's grab bar, drag, poke it where it is ----------

  async function panelMove() {
    const out = [], set = sys().settings, mv = sys().panels, V3 = V();
    if (sys().playkit.playMode !== 'off' && qa.region('hud:end')) await qa.panelPress('hud:end');
    await F.menuPath('settings');
    await qa.frames(15);
    const pn = set.panel, bar = mv.bars.get(pn)?.mesh;
    const sum0 = await sys().sculpt.sculptClient.checksum();
    const p0 = pn.mesh.getWorldPosition(new V3()).toArray();
    let ok = false;
    if (bar?.visible) {
      const b = bar.getWorldPosition(new V3()), eye = w.__world.camera.getWorldPosition(new V3());
      const toEye = eye.clone().sub(b).normalize();
      await qa.moveTo('right', b.clone().addScaledVector(toEye, 0.08).toArray(), 'pinch', 0.03);
      await qa.pinchAt('right', b.toArray());
      await qa.frames(4);
      ok = mv.drag?.panel === pn;
      // drag 15 cm to the player's left and 5 cm up, slowly, then let go
      const side = new V3(toEye.z, 0, -toEye.x).normalize();
      const h = dev().hands.right;
      for (let i = 0; i < 20; i++) {
        h.position.set(h.position.x + side.x * 0.0075, h.position.y + 0.0025, h.position.z + side.z * 0.0075);
        await qa.frames(1);
      }
      await qa.frames(6);
      await qa.pinch('right', false);
      await qa.rest('right');
    }
    await qa.frames(10);
    const p1 = pn.mesh.getWorldPosition(new V3()).toArray(), d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const sum1 = await sys().sculpt.sculptClient.checksum();
    out.push({ name: 'm1. pinch the grab bar and drag: Settings moves about 15 cm and stays; the clay is not touched', pass: ok && d > 0.1 && d < 0.25 && pn.moved.length() > 0.1 && sum1 === sum0 && !mv.drag, detail: `grabbed ${ok}, moved ${d.toFixed(3)} m, clay ${sum1 === sum0 ? 'same' : 'changed'}` });
    // poke a button on the panel where it is now
    const a = await qa.panelPress('about');
    await qa.frames(10);
    out.push({ name: 'm2. a button on the moved panel works by poke', pass: a.ok && pn.page === 'about', detail: `page ${pn.page}` });
    await qa.panelPress('close');
    await qa.frames(10);
    // it opens again where it was left; Recenter puts it back
    await F.menuPath('settings');
    await qa.frames(10);
    const p2 = pn.mesh.getWorldPosition(new V3()).toArray(), kept = pn.moved.length() > 0.1;
    await qa.panelPress('close');
    await F.menuPath('physics', 'recenter');
    await qa.frames(10);
    out.push({ name: 'm3. it opens again where it was moved; Recenter puts every panel back', pass: kept && pn.moved.length() === 0, detail: `reopened at ${p2.map((v) => v.toFixed(2))}, after Recenter moved ${pn.moved.length().toFixed(3)}` });
    return out;
  }

  // ---------- k. seated height (V6 gap 2): the view sits at a seated player's height over the table ----------

  async function seatHeight() {
    const out = [], hs = sys().height, d = dev(), table = 0.72;
    const eyeY = () => w.__world.camera.getWorldPosition(new (V())()).y;
    const handGap = () => input().hands.right.pinchPoint[1] - d.hands.right.position.y;
    const s0 = hs.shift, gap0 = handGap();
    out.push({ name: 'k1. a normal chair (eyes 43 cm over the table): no shift', pass: s0 === 0, detail: `shift ${s0}, eyes ${eyeY().toFixed(2)} m` });
    // a low seat: the head 25 cm lower; Recenter measures again
    d.position.set(d.position.x, 0.9, d.position.z);
    await qa.frames(10);
    let m = await F.menuPath('physics', 'recenter');
    await qa.frames(15);
    const e1 = eyeY(), s1 = hs.shift, gap1 = handGap();
    out.push({ name: 'k2. a low seat + Recenter: the view rises so the eyes are 45 cm over the table; the hands rise with it', pass: m.ok && Math.abs(e1 - (table + 0.45)) < 0.02 && Math.abs(gap1 - gap0 - s1) < 0.02, detail: `shift ${s1.toFixed(3)}, eyes ${e1.toFixed(3)}, hand ${(gap1 - gap0).toFixed(3)} higher` });
    // the menu and the clay still work there
    const v0 = qa.clay().rawVolume;
    await F.menuPath('make', 'add');
    // on the clay's left: earlier steps leave creations resting against its right side (they take a pinch there)
    await F.stroke([-1, 0.3, 0.4], [-0.03, 0.01, 0.02]);
    await qa.frames(20);
    out.push({ name: 'k3. sculpting by hand still works at the new height', pass: qa.clay().rawVolume > v0, detail: `volume ${v0} -> ${qa.clay().rawVolume}` });
    // Table higher: 3 cm (the view 3 cm lower), Table lower back
    m = await F.menuPath('physics', 'tableup');
    await qa.frames(10);
    const s2 = hs.shift;
    await F.menuPath('physics', 'tabledown');
    await qa.frames(10);
    out.push({ name: 'k4. Table higher / lower move it 3 cm and back', pass: m.ok && Math.abs(s1 - s2 - 0.03) < 0.005 && Math.abs(hs.shift - s1) < 0.005, detail: `${s1.toFixed(3)} -> ${s2.toFixed(3)} -> ${hs.shift.toFixed(3)}` });
    // back to the usual seat for the next steps
    d.position.set(d.position.x, 1.15, d.position.z);
    await qa.frames(10);
    await F.menuPath('physics', 'recenter');
    await qa.frames(15);
    out.push({ name: 'k5. back on a normal chair + Recenter: no shift', pass: hs.shift === 0, detail: `shift ${hs.shift}` });
    return out;
  }

  Object.assign(F, { robust, extras, panelMove, seatHeight, throwAt, scoreOf, openPlayKit, obj, grab, swing, waitFor, physicsPush, bringToLife, libraryAndKit, openGameAgent, waitAnswer, backToGames, gameFromCard, pointAt, typeOnKeypad, describeGame, gameOffline, hud, playGame, roomCreate, roomJoin, startKnockDown, throwOne, firstFive });
})();
