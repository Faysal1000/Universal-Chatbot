import { describe, expect, it } from 'vitest';

import { titleFromFirstMessage } from './conversation-title.js';

describe('titleFromFirstMessage', () => {
  it('uses a short first message as is', () => {
    expect(titleFromFirstMessage('  What is the leave policy?  ')).toBe('What is the leave policy?');
  });

  it('keeps only the first line', () => {
    expect(titleFromFirstMessage('Opening hours\nand also holidays')).toBe('Opening hours');
  });

  it('cuts a long message on a word boundary', () => {
    const title = titleFromFirstMessage(
      'Could you please explain in detail how the annual performance review process works here',
    );

    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/\s…$/);
  });

  it('falls back when the message is blank', () => {
    expect(titleFromFirstMessage('   ')).toBe('New conversation');
  });
});
