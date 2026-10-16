import { describe, expect, it } from 'vitest';
import { SculptEngine, type Stroke } from '../../src/sculpt/sculpt-engine';

const LUMP = { x: 0, y: 0, z: 0, r: 0.05 };
const make = () => new SculptEngine(40, 0.25, LUMP);
const add = (x: number): Stroke => ({ op: 'add', x, y: 0.05, z: 0, r: 0.015 });
const carve = (z: number): Stroke => ({ op: 'carve', x: 0, y: 0.02, z, r: 0.012 });

/** The same ordered edits (as the room relay delivers them) to every engine. */
function play(engines: SculptEngine[], ops: [string, string, Stroke[]][]): void {
  for (const e of engines) for (const [owner, key, strokes] of ops) e.apply(key, strokes, owner);
}

describe('shared clay (Update 3, Step C)', () => {
  const OPS: [string, string, Stroke[]][] = [
    ['p1', 'p1:1', [add(0.02)]],
    ['p2', 'p2:1', [carve(0.03)]],
    ['p1', 'p1:1', [add(0.025)]], // p1's gesture continues after p2's
    ['p2', 'p2:2', [carve(-0.03)]],
    ['p1', 'p1:2', [{ op: 'paint', x: 0, y: 0.05, z: 0.04, r: 0.02, rgb: 0xff0000 }]],
  ];

  it('every client gets the same clay from the same ordered edits', () => {
    const [a, b] = [make(), make()];
    play([a, b], OPS);
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(make().checksum());
  });

  it('undo is per player and stays in sync', () => {
    const [a, b] = [make(), make()];
    play([a, b], OPS);
    const before = a.checksum();
    for (const e of [a, b]) expect(e.undo('p2')).toBe(true); // p2's last carve only
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(before);
    // the same as if p2 had never made that carve
    const ref = make();
    play([ref], OPS.filter((o) => o[1] !== 'p2:2'));
    expect(a.checksum()).toBe(ref.checksum());
    for (const e of [a, b]) expect(e.redo('p2')).toBe(true);
    expect(a.checksum()).toBe(b.checksum());
    expect(a.undo('p3')).toBe(false);
  });

  it('a late joiner imports the clay and its history, then stays in sync', () => {
    const host = make();
    play([host], OPS);
    const late = new SculptEngine(48, 0.25, { x: 0, y: 0, z: 0, r: 0.03 }); // different start: replaced by the import
    late.importState(host.exportState());
    expect(late.checksum()).toBe(host.checksum());
    const more: [string, string, Stroke[]][] = [['p3', 'p3:1', [add(-0.02)]]];
    play([host, late], more);
    expect(late.checksum()).toBe(host.checksum());
    for (const e of [host, late]) e.undo('p1'); // undo an edit made before the joiner arrived
    expect(late.checksum()).toBe(host.checksum());
  });

  it('single player still works as before (owner "local")', () => {
    const e = make();
    e.apply(1, [add(0.02)]);
    e.apply(2, [carve(0.02)]);
    const two = e.checksum();
    expect(e.undo()).toBe(true);
    expect(e.redo()).toBe(true);
    expect(e.checksum()).toBe(two);
  });
});
