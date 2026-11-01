import { describe, expect, it } from 'vitest';

import { detectProcessRole } from './process-role.js';

describe('detectProcessRole', () => {
  it.each([
    ['/service/dist/main.worker.js', 'worker'],
    ['/service/dist/main.api.js', 'api'],
    [undefined, 'api'],
  ] as const)('maps %s to %s', (entryScriptPath, expectedRole) => {
    expect(detectProcessRole(entryScriptPath)).toBe(expectedRole);
  });
});
