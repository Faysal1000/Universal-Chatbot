import { describe, expect, it } from 'vitest';

import { parseWidgetPosition, WIDGET_POSITIONS } from './widgetPosition';

describe('widget positions', () => {
  it('offers the nine combinations of top/middle/bottom and left/center/right', () => {
    expect(WIDGET_POSITIONS).toHaveLength(9);
    expect(new Set(WIDGET_POSITIONS).size).toBe(9);
    for (const position of WIDGET_POSITIONS) expect(parseWidgetPosition(position)).toBe(position);
  });

  it('defaults to bottom-right', () => {
    expect(parseWidgetPosition(null)).toBe('bottom-right');
    expect(parseWidgetPosition('center')).toBe('bottom-right');
  });
});
