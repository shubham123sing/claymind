/*
 * The demo video's scenes (docs/SUBMISSION.md), played with the emulated hands at a watchable pace.
 * Loaded after driver.js, flows.js and flows-more.js; everything lives on window.demo. Each scene
 * shows its caption (a page overlay, so it is in the recording) and returns what happened.
 * Scripted hands in the XR emulator: the video says so.
 */
(() => {
  const qa = window.qa, w = window, F = w.qaFlows;
  const sys = () => w.__sys;
  const dev = () => w.IWER_DEVICE;

  // ---------- captions ----------

  function caption(text, sub = '') {
    let el = document.getElementById('demo-cap');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:6%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' +
        'max-width:80%;text-align:center;font:600 46px/1.25 "Segoe UI",system-ui,sans-serif;color:#fff;' +
        'background:rgba(18,20,24,.78);padding:18px 38px;border-radius:22px;transition:opacity .4s;opacity:0';
      document.body.appendChild(el);
    }
    el.innerHTML = text ? `${text}${sub ? `<div style="font-size:28px;font-weight:400;opacity:.85;margin-top:6px">${sub}</div>` : ''}` : '';
    el.style.opacity = text ? '1' : '0';
  }

  const hold = (ms) => qa.sleep(ms);

  /** Turn the head (degrees: yaw left +, pitch down -) smoothly over n frames. */
  async function look(yawDeg, pitchDeg, n = 40) {
    const q = dev().quaternion, Q = w.__world.camera.quaternion.constructor, E = w.__world.camera.rotation.constructor;
    const from = new Q(q.x, q.y, q.z, q.w), to = new Q().setFromEuler(new E((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ'));
    const t = new Q();
    for (let i = 1; i <= n; i++) {
      const k = i / n, s = k * k * (3 - 2 * k);
      t.slerpQuaternions(from, to, s);
      q.set(t.x, t.y, t.z, t.w);
      await qa.frames(1);
    }
  }

  // ---------- setup ----------

  async function setup() {
    sys().sculpt.hud?.setVisible(false); // the ?debug stats panel
    if (qa.region('skip')) await qa.panelPress('skip'); // the first-run tutorial card
    await Promise.all([qa.rest('left'), qa.rest('right')]);
    await qa.frames(30);
    return { ok: true };
  }

  // ---------- 1. sculpt a small creature ----------

  async function sculpt() {
    caption('Sculpt with your hands', 'Pinch the clay and pull');
    await F.menuPath('make', 'shape');
    // two ears, a snout and a tail, pulled out of the lump
    await F.stroke([-0.45, 1, 0], [0, 0.035, 0], 'right', 22);
    await F.stroke([0.45, 1, 0], [0, 0.035, 0], 'right', 22);
    await F.stroke([0, 0.25, 1], [0, 0, 0.03], 'right', 22);
    await F.stroke([0, 0.2, -1], [0, 0.01, -0.035], 'right', 22);
    caption('Add, carve, smooth', 'Every tool is on your palm menu');
    await F.menuPath('make', 'carve');
    await F.stroke([-0.3, 0.55, 1], [0, 0, -0.008], 'right', 10);
    await F.stroke([0.3, 0.55, 1], [0, 0, -0.008], 'right', 10);
    await F.menuPath('make', 'smooth');
    await F.stroke([1, 0.3, 0.3], [0, 0.015, 0.015], 'right', 16);
    caption('Give it a colour');
    await F.menuPath('matcol', 'color');
    const sw = qa.regions('s').filter((r) => /^s\d+$/.test(r) && r !== 's0')[3];
    if (sw) await qa.panelPress(sw);
    await qa.panelPress('piece');
    await qa.frames(20);
    if (qa.region('close')) await qa.panelPress('close');
    await hold(1200);
    return { ok: true, clay: qa.clay() };
  }

  // ---------- 2. bring it to life ----------

  async function life() {
    caption('Bring it to life', 'Real physics: it has weight and balance');
    const id = await F.bringToLife();
    await hold(800);
    if (!id) return { ok: false };
    // pick it up, carry it a little and let it go: it drops and rolls on the table
    if (await F.grab(id)) {
      const o = F.obj(id);
      await F.swing('right', [o.p[0] - 0.05, o.p[1] + 0.14, o.p[2] - 0.05], 0.006);
      await hold(600);
      await qa.pinch('right', false);
      await qa.rest('right');
    }
    await hold(2500);
    return { ok: true, id };
  }

  // ---------- 3. make it a game ----------

  async function game() {
    caption('Make it a game', 'A game agent picks a game and checks its rules');
    const online = await F.openGameAgent();
    await hold(1500);
    await F.backToGames();
    await qa.panelPress('game:Bowling');
    const a = await F.waitAnswer();
    caption('Make it a game', 'The referee plays it in the physics first, then it is yours');
    await hold(4000);
    caption('Throw by hand', 'Score with a pinch and a swing');
    const played = await F.playGame();
    await hold(1500);
    if (sys().playkit.playMode !== 'off' && qa.region('hud:end')) await qa.panelPress('hud:end');
    await qa.frames(30);
    return { ok: a.view === 'preview', online, game: a.name, played };
  }

  // ---------- 4. keep what you make ----------

  async function keep() {
    caption('Keep what you make', 'Your Library and your Play Kit');
    const id = sys().objects.liveCreationIds().at(-1);
    if (id) {
      await qa.pose('right', 'point');
      const o = F.obj(id);
      await qa.moveTo('right', [o.p[0] + o.r * 0.7, o.p[1] + 0.02, o.p[2] + 0.02], 'tip', 0.01);
      await qa.rest('right');
    }
    await F.menuPath('lib', 'libadd');
    await qa.frames(30);
    await F.menuPath('lib', 'library');
    await hold(3000);
    await F.menuPath('lib', 'library');
    await qa.frames(10);
    await F.menuPath('kit', 'kitadd');
    await qa.frames(20);
    await F.openPlayKit();
    await qa.panelPress('tab:kit');
    await hold(3000);
    if (qa.region('close')) await qa.panelPress('close');
    caption("Today's challenge", 'A new goal every day');
    await F.menuPath('kit', 'daily');
    await hold(3500);
    return { ok: true, library: sys().library.panel.items.length, kit: sys().playkit.kitItems().length };
  }

  // ---------- 5. comfort ----------

  async function comfort() {
    caption('Made for sitting down', 'Move any panel by its bar · Recenter puts everything back');
    await F.menuPath('settings');
    await qa.frames(15);
    const pn = sys().settings.panel, bar = sys().panels.bars.get(pn)?.mesh;
    if (bar?.visible) {
      const V3 = w.__world.camera.position.constructor;
      const b = bar.getWorldPosition(new V3()), eye = w.__world.camera.getWorldPosition(new V3());
      const toEye = eye.clone().sub(b).normalize();
      await qa.moveTo('right', b.clone().addScaledVector(toEye, 0.08).toArray(), 'pinch', 0.02);
      await qa.pinchAt('right', b.toArray(), 0.01);
      const side = new V3(toEye.z, 0, -toEye.x).normalize(), h = dev().hands.right;
      for (let i = 0; i < 40; i++) {
        h.position.set(h.position.x + side.x * 0.004, h.position.y + 0.0012, h.position.z + side.z * 0.004);
        await qa.frames(1);
      }
      await qa.pinch('right', false);
      await qa.rest('right');
    }
    await hold(1500);
    await qa.panelPress('close');
    await F.menuPath('physics', 'recenter');
    await hold(1200);
    return { ok: true };
  }

  // ---------- 6. multiplayer (both players' pages) ----------

  async function roomCreate() {
    caption('Play together', 'Make a room and share its code (beta)');
    return F.roomCreate();
  }

  async function roomJoin(code) {
    caption('Play together', 'Join by typing the code with a pinch');
    return F.roomJoin(code);
  }

  /** On player 1: pull the shared clay, player 2 sees it change. */
  async function sharedPull() {
    caption('Play together', 'One sculpts, the other sees it at once');
    await F.menuPath('make', 'shape');
    await F.stroke([-1, 0.3, 0.3], [-0.04, 0.01, 0], 'right', 22);
    await hold(2500);
    return { ok: true };
  }

  w.demo = { caption, look, hold, setup, sculpt, life, game, keep, comfort, roomCreate, roomJoin, sharedPull };
})();
