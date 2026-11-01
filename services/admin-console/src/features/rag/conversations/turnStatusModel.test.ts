import { isHiddenFromVisitor, turnPlacard } from './turnStatusModel';

describe('turnPlacard', () => {
  it('tells a fallback answer apart from a normal one', () => {
    expect(turnPlacard({ status: 'completed', finishReason: 'stop' })).toEqual({ state: 'ready', label: 'Answered' });
    expect(turnPlacard({ status: 'completed', finishReason: 'no_evidence' })).toEqual({
      state: 'warning',
      label: 'No evidence (fallback)',
    });
  });

  it('shows a failed turn as failed', () => {
    expect(turnPlacard({ status: 'failed', finishReason: null }).state).toBe('failed');
  });
});

describe('isHiddenFromVisitor', () => {
  it('is true for superseded and replaced turns only', () => {
    expect(isHiddenFromVisitor({ status: 'superseded' })).toBe(true);
    expect(isHiddenFromVisitor({ status: 'replaced' })).toBe(true);
    expect(isHiddenFromVisitor({ status: 'completed' })).toBe(false);
  });
});
