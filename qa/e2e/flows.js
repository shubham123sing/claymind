/*
 * The scripted user flows (hands only) for the XR end-to-end test. Each flow returns
 * { pass, detail, data }. Uses window.qa (driver.js). Loaded after the driver.
 */
(() => {
  const qa = window.qa, w = window;
  const sys = () => w.__sys;
  const dev = () => w.IWER_DEVICE;
  const add = (p, n, k) => p.map((v, i) => v + n[i] * k);
  const r1 = (x) => Math.round(x * 10) / 10;

  // ---------- the wrist menu (left palm up, poked with the right index finger) ----------

  async function openMenu() {
    const L = dev().hands.left;
    L.quaternion.set(0, 0, 1, 0); // palm up
    await qa.moveTo('left', [-0.16, 0.95, -0.28], 'palm', 0.03);
    for (let i = 0; i < 40 && qa.menuShown().length < 3; i++) await qa.frames(2);
    await qa.frames(12); // the open animation
    return qa.menuShown().length > 0;
  }

  async function closeMenu() {
    dev().hands.left.quaternion.set(0, 0, 0, 1);
    await qa.rest('left');
  }

  /** Category then action, e.g. menuPath('make', 'add'). */
  async function menuPath(...ids) {
    if (!(await openMenu())) return { ok: false, why: 'menu did not open' };
    for (const id of ids) {
      if (!qa.menuButton(id) && qa.menuButton('back')) {
        await qa.menuPress('back');
        await qa.frames(8);
      }
      const r = await qa.menuPress(id);
      if (!r.ok) {
        await closeMenu();
        return r;
      }
      await qa.frames(10);
    }
    await closeMenu();
    return { ok: true };
  }

  // ---------- sculpting strokes ----------

  /** Pinch on the clay surface toward `dir` and drag along `move` (m), then let go. */
  async function stroke(dir, move, side = 'right', steps = 12) {
    const s = qa.claySurface(dir);
    if (!s) return false;
    // approach from outside, then close the fingers on the surface
    await qa.pinchAt(side, add(s.p, s.n, 0.002));
    await qa.frames(4);
    const h = dev().hands[side];
    for (let i = 0; i < steps; i++) {
      h.position.set(h.position.x + move[0] / steps, h.position.y + move[1] / steps, h.position.z + move[2] / steps);
      await qa.frames(2);
    }
    await qa.frames(6);
    await qa.pinch(side, false);
    await qa.moveTo(side, add(qa.point(side, 'pinch'), s.n, 0.05), 'pinch', 0.02);
    await qa.frames(20);
    return true;
  }

  /** Painted surface: how many clay vertices carry paint (the paint layer, not the piece colour). */
  function clayColorSum() {
    let n = 0;
    sys().sculpt.view.root.traverse((o) => {
      const p = o.isMesh && o.geometry?.userData?.paint;
      if (p) for (let i = 3; i < p.length; i += 4) if (p[i] > 0) n++;
    });
    return n;
  }

  // ---------- a. sculpting ----------

  async function sculpt() {
    const out = [];
    const c0 = qa.clay();
    // add clay: the Add tool, pinch the surface and draw outward
    let m = await menuPath('make', 'add');
    const tool1 = qa.clay().tool;
    await stroke([1, 0.3, 0.5], [0.05, 0.01, 0.02]);
    const c1 = qa.clay();
    out.push({ name: 'add clay (Add tool, pinch-draw)', pass: m.ok && tool1 === 'add' && c1.volume > c0.volume, detail: `tool ${tool1}, volume ${c0.volume} -> ${c1.volume} cm3` });
    // grab and move: the Shape tool pulls the surface it holds
    m = await menuPath('make', 'shape');
    await stroke([-1, 0.2, 0.2], [-0.05, 0, 0]);
    const c2 = qa.clay();
    out.push({ name: 'grab and pull (Shape tool)', pass: m.ok && c2.size[0] > c1.size[0] + 0.5, detail: `width ${c1.size[0]} -> ${c2.size[0]} cm` });
    // two-hand scale: both hands pinch in the air above the clay and spread
    const cc = qa.clay().center;
    await qa.pose('left', 'default');
    await Promise.all([qa.moveTo('left', [cc[0] - 0.09, cc[1] + 0.2, cc[2] + 0.05], 'pinch', 0.03), qa.moveTo('right', [cc[0] + 0.09, cc[1] + 0.2, cc[2] + 0.05], 'pinch', 0.03)]);
    await Promise.all([qa.pinch('left', true), qa.pinch('right', true)]);
    await qa.frames(6);
    const L = dev().hands.left, R = dev().hands.right;
    for (let i = 0; i < 12; i++) {
      L.position.x -= 0.006;
      R.position.x += 0.006;
      await qa.frames(2);
    }
    await qa.frames(6);
    await Promise.all([qa.pinch('left', false), qa.pinch('right', false)]);
    await qa.frames(10);
    const c3 = qa.clay();
    // and back down (pinch both, bring the hands together), so later creations are a normal size
    await Promise.all([qa.moveTo('left', [cc[0] - 0.16, cc[1] + 0.2, cc[2] + 0.05], 'pinch', 0.03), qa.moveTo('right', [cc[0] + 0.16, cc[1] + 0.2, cc[2] + 0.05], 'pinch', 0.03)]);
    await Promise.all([qa.pinch('left', true), qa.pinch('right', true)]);
    await qa.frames(6);
    for (let i = 0; i < 40 && sys().sculpt.view.root.scale.x > 1.03; i++) {
      L.position.x += 0.003;
      R.position.x -= 0.003;
      await qa.frames(2);
    }
    await Promise.all([qa.pinch('left', false), qa.pinch('right', false)]);
    await qa.frames(10);
    const back = sys().sculpt.view.root.scale.x;
    out.push({ name: 'two-hand scale (pinch both, spread; then back)', pass: c3.scale > c2.scale * 1.05 && back < c3.scale, detail: `scale ${c2.scale.toFixed(2)} -> ${c3.scale.toFixed(2)} -> ${back.toFixed(2)}, size at most ${c3.size.join(' x ')} cm` });
    await Promise.all([qa.rest('left'), qa.rest('right')]);
    // smooth: the Smooth tool, rub the bump
    m = await menuPath('make', 'smooth');
    const tris0 = sys().sculpt.view.triangles, sz0 = qa.clay().size.join();
    await stroke([1, 0.3, 0.5], [0, 0.02, 0.02]);
    await stroke([1, 0.3, 0.5], [0, -0.02, -0.02]);
    const c4 = qa.clay();
    out.push({ name: 'smooth (Smooth tool, rub)', pass: m.ok && qa.clay().tool === 'smooth' && (c4.size.join() !== sz0 || sys().sculpt.view.triangles !== tris0 || c4.volume !== c3.volume), detail: `volume ${c3.volume} -> ${c4.volume}, size ${sz0} -> ${c4.size.join()}` });
    // remove a bit: the Carve tool, pinch into the surface
    m = await menuPath('make', 'carve');
    await stroke([0, 0.6, 1], [0, -0.01, -0.02]);
    const c5 = qa.clay();
    out.push({ name: 'remove a bit (Carve tool)', pass: m.ok && c5.volume < c4.volume, detail: `volume ${c4.volume} -> ${c5.volume} cm3` });
    return out;
  }

  // ---------- b. colour, paint, material ----------

  async function colourPaintMaterial() {
    const out = [];
    // colour for a clay piece: Material & Colour -> Color -> a swatch
    let m = await menuPath('matcol', 'color');
    const regs = qa.regions('s');
    const sw = regs.find((r) => /^s\d+$/.test(r) && r !== 's0');
    let p = sw ? await qa.panelPress(sw) : { ok: false, why: 'no swatch' };
    await qa.frames(6);
    // the swatch picks the colour; "Colour piece" applies it to the piece
    const pc = await qa.panelPress('piece');
    p = { ok: p.ok && pc.ok };
    await qa.frames(10);
    const t = sys().sculpt.clayTarget();
    out.push({ name: 'colour for one piece (Color picker swatch)', pass: m.ok && p.ok && t.chosen, detail: `swatch ${sw}, piece ${t.piece + 1} colour ${t.color}` });
    if (qa.region('close')) await qa.panelPress('close');
    // paint on the surface: Paint -> Paint tool, pinch-draw on the clay
    // paint in a different colour than the piece (the same colour would leave no mark)
    await menuPath('paintg', 'color');
    const other = qa.regions('s').filter((r) => /^s\d+$/.test(r) && r !== sw && r !== 's0')[1];
    if (other) await qa.panelPress(other);
    if (qa.region('close')) await qa.panelPress('close');
    m = await menuPath('paintg', 'paint');
    const sum0 = clayColorSum();
    await stroke([0.3, 0.7, 1], [0.03, 0, 0]);
    await qa.frames(20);
    const sum1 = clayColorSum();
    out.push({ name: 'paint on the surface (Paint tool)', pass: m.ok && qa.clay().tool === 'paint' && sum1 !== sum0, detail: `painted vertices ${sum0} -> ${sum1}` });
    // bring it to life, touch it, pick its material: Material & Colour -> Material
    const n0 = sys().objects.liveCreationIds().length;
    const id = await w.qaFlows.bringToLife();
    m = { ok: !!id };
    out.push({ name: 'bring to life (Physics -> Bring to life)', pass: m.ok && sys().objects.liveCreationIds().length > n0, detail: `creations ${n0} -> ${sys().objects.liveCreationIds().length}` });
    const rec = id && sys().objects.byCreation(id);
    if (!rec) return out;
    // touch it with the fingertip (it becomes the focus)
    const at = rec.mesh.position.toArray();
    await qa.pose('right', 'point');
    await qa.moveTo('right', [at[0] + 0.12, at[1] + 0.05, at[2] + 0.06], 'tip', 0.03);
    await qa.moveTo('right', [at[0] + rec.radius * 0.7, at[1] + 0.02, at[2] + 0.02], 'tip', 0.01);
    await qa.frames(10);
    await qa.rest('right');
    const before = rec.parts[0].mat.id;
    m = await menuPath('matcol', 'material');
    await qa.frames(10);
    const mats = qa.regions().filter((r) => r !== before && r !== 'remove' && !r.includes(':') && /^[a-z]+$/.test(r));
    const pick = mats.find((x) => ['steel', 'wood', 'rubber', 'glass', 'stone', 'plastic'].includes(x)) ?? mats[0];
    p = pick ? await qa.panelPress(pick) : { ok: false };
    for (let i = 0; i < 60 && sys().objects.byCreation(id)?.parts[0].mat.id === before; i++) await qa.frames(5);
    const after = sys().objects.byCreation(id)?.parts[0].mat.id;
    out.push({ name: 'material for the object (Material picker)', pass: m.ok && p.ok && after === pick, detail: `${before} -> ${after} (picked ${pick}; options ${mats.slice(0, 8).join(',')})` });
    return out;
  }

  w.qaFlows = { openMenu, closeMenu, menuPath, stroke, clayColorSum, sculpt, colourPaintMaterial };
})();
