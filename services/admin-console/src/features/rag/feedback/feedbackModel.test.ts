import type { FeedbackEntry } from './api/feedbackTypes';
import { countRatings, filterFeedbackByRating, ratedMessageLink } from './feedbackModel';

function aFeedbackEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    rating: 'up',
    comment: null,
    questionExcerpt: 'Where is the leave policy?',
    answerExcerpt: 'The leave policy is on page 4 [1].',
    createdAt: '2026-10-30T10:00:00Z',
    ...overrides,
  };
}

const entries = [
  aFeedbackEntry(),
  aFeedbackEntry({ messageId: 'message-2', rating: 'down', comment: 'Wrong page cited' }),
  aFeedbackEntry({ messageId: 'message-3', rating: 'down', comment: '  ' }),
];

describe('filterFeedbackByRating', () => {
  it('keeps only the chosen rating', () => {
    expect(filterFeedbackByRating(entries, 'down').map((entry) => entry.messageId)).toEqual(['message-2', 'message-3']);
  });

  it('keeps everything for all', () => {
    expect(filterFeedbackByRating(entries, 'all')).toHaveLength(3);
  });
});

describe('countRatings', () => {
  it('counts ratings and non-blank comments', () => {
    expect(countRatings(entries)).toEqual({ up: 1, down: 2, withComment: 1 });
  });
});

describe('ratedMessageLink', () => {
  it('points at the message inside its conversation', () => {
    expect(ratedMessageLink({ conversationId: 'c1', messageId: 'm1' })).toBe('/rag/conversations/c1#message-m1');
  });
});
