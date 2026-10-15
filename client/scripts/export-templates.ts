/**
 * The five built-in Game Specs and the spec vocabulary, as written to
 * server/agents/data/game-templates.json, so the agent backend's Referee and
 * Designer use exactly what the client plays. After changing templates run
 *   UPDATE_TEMPLATES=1 npx vitest run tests/unit/templates-export.test.ts
 * (the same test fails while the file is out of date).
 */
import { ACTIONS, FALLBACK_SHAPES, HAND_ACTIONS, ROLE_TAGS, SPEC_VERSION, TRIGGERS } from '../src/playkit/game-spec';
import { TEMPLATES } from '../src/playkit/templates';
import { FALLBACK_SIZE } from '../src/playkit/kit-store';

export function templatesFile(): string {
  const data = {
    specVersion: SPEC_VERSION,
    vocabulary: { roleTags: ROLE_TAGS, triggers: TRIGGERS, actions: ACTIONS, handActions: HAND_ACTIONS, fallbackShapes: FALLBACK_SHAPES, fallbackSizeM: FALLBACK_SIZE },
    templates: TEMPLATES,
  };
  return JSON.stringify(data, null, 1) + '\n';
}

