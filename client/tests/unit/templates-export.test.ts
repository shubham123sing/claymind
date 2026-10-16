import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { templatesFile } from '../../scripts/export-templates';

const FILE = new URL('../../../server/agents/data/game-templates.json', import.meta.url);

describe('game templates shared with the agent backend', () => {
  it('server/agents/data/game-templates.json matches the client templates', () => {
    if (process.env.UPDATE_TEMPLATES) writeFileSync(FILE, templatesFile());
    const onDisk = readFileSync(FILE, 'utf8');
    expect(onDisk.replace(/\r\n/g, '\n'), 'run: UPDATE_TEMPLATES=1 npx vitest run tests/unit/templates-export.test.ts').toBe(templatesFile());
  });
});
