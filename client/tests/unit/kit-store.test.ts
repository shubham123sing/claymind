import { describe, expect, it } from 'vitest';
import { BoxGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { kitFromJson, kitToJson, makeKitItem, measure, suggestRole, suggestRoleMap, type KitItem, type PlaySet } from '../../src/playkit/kit-store';
import { templateById } from '../../src/playkit/templates';
import type { SavedCreation } from '../../src/storage/library';

function saved(g: BufferGeometry, materialId: string, name: string, volumeCm3: number, frame = { p: [0, 0, 0], q: [0, 0, 0, 1] }): SavedCreation {
  const n = g.toNonIndexed();
  const positions = new Float32Array(n.getAttribute('position').array), normals = new Float32Array(n.getAttribute('normal').array);
  return {
    schemaVersion: 1, id: 'x', savedAt: 1, pinned: false, thumb: 'data:image/jpeg;base64,AA==', pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
    creation: { id: 'x', name, parts: [{ materialId }], massKg: 0.1, volumeCm3 } as never,
    parts: [{ label: 0, materialId, color: null, mesh: { positions, normals }, shards: [], frame } as never],
  };
}

describe('Play Kit items', () => {
  it('measures size (with the piece frame), mass and fill', () => {
    const s = saved(new BoxGeometry(0.04, 0.02, 0.1), 'wood', 'Brick', 80, { p: [0.5, 0, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] });
    const st = measure(s);
    expect(st.sizeCm).toEqual([10, 2, 4]); // turned 90° about y
    expect(st.fill).toBeCloseTo(1, 1);
    expect(st.materials).toEqual(['wood']);
  });

  it('guesses roles from shape: board, ball, cup, ramp', () => {
    expect(suggestRole(measure(saved(new BoxGeometry(0.36, 0.015, 0.36), 'wood', 'b', 36 * 1.5 * 36)))).toBe('board');
    expect(suggestRole(measure(saved(new SphereGeometry(0.02, 24, 16), 'rubber', 'b', 33.5)))).toBe('piece');
    expect(suggestRole(measure(saved(new CylinderGeometry(0.035, 0.035, 0.07, 24), 'plastic', 'c', 60)))).toBe('container'); // a hollow cup: little volume for its box
    expect(suggestRole(measure(saved(new BoxGeometry(0.06, 0.02, 0.38), 'wood', 'r', 6 * 2 * 38)))).toBe('launcher');
  });

  it('suggests kit items for game roles by tag and size, built-in when nothing fits', () => {
    const ball = makeKitItem(saved(new SphereGeometry(0.019, 24, 16), 'steel', 'My ball', 28.7), 'My ball', 'kit_ball');
    const board = makeKitItem(saved(new BoxGeometry(0.36, 0.015, 0.36), 'plastic', 'Board', 1944), 'Board', 'kit_board');
    const huge = makeKitItem(saved(new SphereGeometry(0.3, 16, 8), 'foam', 'Moon', 113000), 'Moon', 'kit_moon');
    huge.role = 'piece';
    const kd = suggestRoleMap(templateById('knock-down')!, [ball, board, huge]);
    expect(kd.ball).toBe('kit_ball');
    expect(kd.block).toBeNull(); // a ball is a "piece" but cannot stack like a block: built-in blocks
    const fp = suggestRoleMap(templateById('flick-and-pocket')!, [ball, board, huge]);
    expect(fp.board).toBe('kit_board');
    const mr = suggestRoleMap(templateById('marble-run')!, [huge]);
    expect(mr).toEqual({ ramp: null, marble: null }); // 30 cm ball: no marble
  });

  it('kit file: round trip with a Set, and refusals', () => {
    const item: KitItem = makeKitItem(saved(new SphereGeometry(0.02, 12, 8), 'rubber', 'Ball', 33), 'Ball', 'kit_a');
    const set: PlaySet = {
      schema: 1, id: 'set_1', name: 'Bowling', savedAt: 1, physics: { gravity: 1 },
      pieces: [
        { kitId: 'kit_a', role: 'ball:0', pose: { p: [0, 0.02, 0.05], q: [0, 0, 0, 1] }, pinned: false },
        { kitId: null, builtin: { shape: 'block', material: 'wood' }, role: 'block:0', pose: { p: [0, 0.02, -0.2], q: [0, 0, 0, 1] }, pinned: false },
      ],
      game: { templateId: 'knock-down', roleMap: { ball: 'kit_a', block: null } },
    };
    const back = kitFromJson(kitToJson([item], [set]));
    expect(back.items[0].name).toBe('Ball');
    expect(back.items[0].data.parts[0].mesh.positions).toEqual(item.data.parts[0].mesh.positions);
    expect(back.sets[0].pieces).toHaveLength(2);
    expect(() => kitFromJson('{"format":"claymind-project"}')).toThrow(/kit file/);
    const bad = JSON.parse(kitToJson([item], [set]));
    bad.sets[0].pieces[0].kitId = 'kit_missing';
    expect(() => kitFromJson(JSON.stringify(bad))).toThrow(/Damaged/);
  });
});
