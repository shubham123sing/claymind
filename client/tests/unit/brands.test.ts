import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The brand list lives in server/agents/brand.py (one list for the game and the agents). */
function brands(): string[] {
  const py = readFileSync(join(__dirname, '../../../server/agents/brand.py'), 'utf8');
  const block = py.slice(py.indexOf('GENERIC'), py.indexOf('}', py.indexOf('GENERIC')));
  return [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
}

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|uikitml|json)$/.test(f)) out.push(p);
  }
  return out;
}

describe('no brand names in the game (V6)', () => {
  it('every source and UI text is brand-free', () => {
    const list = brands();
    expect(list.length).toBeGreaterThan(10);
    const escape = (b: string) => b.replace(/[.*+?^${}()|[\]\\-]/g, (c) => `\\${c}`);
    const re = new RegExp(String.raw`(?<![\w-])(` + list.map(escape).join('|') + String.raw`)(?![\w-])`, 'i');
    const root = join(__dirname, '../..');
    const hits = [...files(join(root, 'src')), ...files(join(root, 'public/ui')), ...files(join(root, 'public/scenes'))]
      .flatMap((f) => (re.test(readFileSync(f, 'utf8')) ? [`${f}: ${readFileSync(f, 'utf8').match(re)![0]}`] : []));
    expect(hits).toEqual([]);
  });
});
