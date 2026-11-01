import { describe, expect, it } from 'vitest';

import { toPlainPreview } from './messagePreview';

describe('toPlainPreview', () => {
  it('drops emphasis and code marks', () => {
    expect(toPlainPreview('The **refund window** is `30 days`, _not_ 60.')).toBe(
      'The refund window is 30 days, not 60.',
    );
  });

  it('keeps link text and drops the target', () => {
    expect(toPlainPreview('See [the policy](https://example.com/policy) [1].')).toBe('See the policy [1].');
  });

  it('drops heading, list and quote markers and folds line breaks', () => {
    expect(toPlainPreview('## Steps\n- Open settings\n> note')).toBe('Steps Open settings note');
  });

  it('leaves plain text alone, including snake_case words', () => {
    expect(toPlainPreview('Use max_answer_tokens here')).toBe('Use max_answer_tokens here');
  });
});
