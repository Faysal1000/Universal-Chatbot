import { describe, expect, it } from 'vitest';

import { dependencyPlacardState } from './healthState';

describe('dependencyPlacardState', () => {
  it.each(['up', 'ok', 'ready', 'healthy', 'OK'])('treats %s as ready', (status) => {
    expect(dependencyPlacardState(status)).toBe('ready');
  });

  it.each(['down', 'error', 'degraded', ''])('treats %s as failed', (status) => {
    expect(dependencyPlacardState(status)).toBe('failed');
  });
});
