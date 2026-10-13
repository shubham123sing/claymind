import { describe, expect, it, vi } from 'vitest';

vi.mock('@iwsdk/core', async () => await import('three'));

// GLTFExporter reads Blobs with FileReader (browser only): a minimal stand-in
class FileReaderStub {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) {
    void b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
  readAsDataURL(b: Blob) {
    void b.arrayBuffer().then((r) => {
      this.result = `data:${b.type};base64,${Buffer.from(r).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
vi.stubGlobal('FileReader', FileReaderStub);

const { Box3, BoxGeometry, Mesh } = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { buildExportScene, exportGlb, COPYRIGHT } = await import('../../src/export/glb');
const { projectFromJson, projectToJson, ImportError } = await import('../../src/export/project-file');
const { validateBytes } = (await import('gltf-validator')) as unknown as { validateBytes: (b: Uint8Array) => Promise<{ issues: { numErrors: number; messages: unknown[] } }> };
type Saved = import('../../src/storage/library').SavedCreation;

/** A closed box as a triangle soup (like baked clay), optionally painted on its +y half. */
function boxMesh(w: number, h: number, d: number, paint?: [number, number, number]) {
  const g = new BoxGeometry(w, h, d, 2, 2, 2).toNonIndexed();
  const positions = new Float32Array(g.getAttribute('position').array);
  const normals = new Float32Array(g.getAttribute('normal').array);
  const n = positions.length / 3;
  const p = paint ? new Uint8Array(n * 4) : undefined;
  if (p && paint) for (let v = 0; v < n; v++) if (positions[v * 3 + 1] > 0) p.set([...paint, 255], v * 4);
  return { positions, normals, paint: p };
}

/** Hammer-like: steel head, wood handle, glass knob (painted red on top). */
function hammer(): Saved {
  const parts = [
    { label: 0, materialId: 'steel', color: null, mesh: boxMesh(0.1, 0.04, 0.04), frame: { p: [0, 0.2, 0], q: [0, 0, 0, 1] } },
    { label: 1, materialId: 'wood', color: '#8a5a2b', mesh: boxMesh(0.03, 0.2, 0.03), frame: { p: [0, 0.08, 0], q: [0, 0, 0, 1] } },
    { label: 2, materialId: 'glass', color: null, mesh: boxMesh(0.04, 0.04, 0.04, [220, 30, 30]), frame: { p: [0, -0.04, 0], q: [0, 0, 0.3826834, 0.9238795] } },
  ];
  return {
    schemaVersion: 1, id: 'lib_test', savedAt: 1, pinned: false, thumb: 'data:image/jpeg;base64,AA==', pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
    creation: { id: 'lib_test', name: 'Test hammer', parts: parts.map((p) => ({ materialId: p.materialId })), massKg: 0 },
    parts: parts.map((p) => ({ ...p, shards: [] })),
  } as unknown as Saved;
}

function jsonChunk(glb: ArrayBuffer): Record<string, any> {
  const dv = new DataView(glb);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, len)));
}

describe('GLB export', () => {
  it('3 pieces (steel, wood, glass) -> 3 named nodes, PBR per piece, paint as COLOR_0, physics extras, copyright', async () => {
    const glb = await exportGlb(hammer(), 'cc0');
    const json = jsonChunk(glb);
    expect(json.asset.copyright).toBe(COPYRIGHT.cc0);
    const names = json.nodes.map((n: { name: string }) => n.name);
    expect(names).toEqual(expect.arrayContaining(['piece_1_steel', 'piece_2_wood', 'piece_3_glass']));
    const root = json.nodes.find((n: { name: string }) => n.name === 'Test hammer');
    const x = root.extras.claymind;
    expect(x.pieces.map((p: { materialId: string }) => p.materialId)).toEqual(['steel', 'wood', 'glass']);
    expect(x.pieces[0]).toMatchObject({ id: 1, density: 7850 });
    expect(x.totalMassKg).toBeGreaterThan(1); // 0.1 x 0.04 x 0.04 m of steel = 1.256 kg + wood + glass
    expect(x.centerOfMass).toHaveLength(3);
    expect(json.materials).toHaveLength(3);
    const glass = json.materials.find((m: { name: string }) => m.name === 'glass');
    expect(glass.alphaMode).toBe('BLEND');
    expect(json.materials.find((m: { name: string }) => m.name === 'steel').pbrMetallicRoughness.metallicFactor).toBe(1);
    const painted = json.meshes.filter((m: { primitives: { attributes: Record<string, number> }[] }) => 'COLOR_0' in m.primitives[0].attributes);
    expect(painted).toHaveLength(1); // only the painted glass piece
    const wood = json.materials.find((m: { name: string }) => m.name === 'wood').pbrMetallicRoughness.baseColorFactor;
    expect(wood[0]).toBeGreaterThan(wood[2]); // brown, not white
  });

  it('origin at the base centre, Y-up, and a re-import keeps the piece count and size within 1 mm', async () => {
    const s = hammer();
    const { root } = buildExportScene(s);
    root.updateMatrixWorld(true);
    const before = new Box3().setFromObject(root);
    expect(before.min.y).toBeCloseTo(0, 6);
    expect((before.min.x + before.max.x) / 2).toBeCloseTo(0, 6);
    const glb = await exportGlb(s, 'reserved');
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const meshes: InstanceType<typeof Mesh>[] = [];
    gltf.scene.traverse((o) => (o as InstanceType<typeof Mesh>).isMesh && meshes.push(o as InstanceType<typeof Mesh>));
    expect(meshes).toHaveLength(3);
    gltf.scene.updateMatrixWorld(true);
    const after = new Box3().setFromObject(gltf.scene);
    for (const k of ['min', 'max'] as const) for (const a of ['x', 'y', 'z'] as const) expect(Math.abs(after[k][a] - before[k][a])).toBeLessThan(0.001);
    expect(jsonChunk(glb).asset.copyright).toBe(COPYRIGHT.reserved);
  });

  it('passes the Khronos glTF validator with no errors', async () => {
    const glb = await exportGlb(hammer(), 'cc0');
    const report = await validateBytes(new Uint8Array(glb));
    expect(report.issues.messages.filter((m) => (m as { severity: number }).severity === 0)).toEqual([]);
    expect(report.issues.numErrors).toBe(0);
  });
});

describe('.claymind.json project file', () => {
  it('round-trips a Library item (meshes, paint, frames, name)', () => {
    const s = hammer();
    const back = projectFromJson(projectToJson(s));
    expect(back.creation.name).toBe('Test hammer');
    expect(back.parts).toHaveLength(3);
    expect(back.parts[2].mesh.positions).toEqual(s.parts[2].mesh.positions);
    expect(back.parts[2].mesh.paint).toEqual(s.parts[2].mesh.paint);
    expect(back.parts[2].frame).toEqual(s.parts[2].frame);
  });

  it('refuses anything else', () => {
    expect(() => projectFromJson('{"hello":1}')).toThrow(ImportError);
    expect(() => projectFromJson('not json')).toThrow(ImportError);
    expect(() => projectFromJson('x'.repeat(10 * 1024 * 1024 + 1))).toThrow(/too large/);
    const bad = JSON.parse(projectToJson(hammer()));
    bad.item.parts[0].mesh = { positions: [1, 2] };
    expect(() => projectFromJson(JSON.stringify(bad))).toThrow(/Damaged/);
  });
});
