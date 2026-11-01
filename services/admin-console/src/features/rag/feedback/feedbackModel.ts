import { conversationPath } from '@/shared/routePaths';

import { messageAnchorId } from '../conversations/messageAnchor';
import type { FeedbackEntry } from './api/feedbackTypes';

export type RatingFilter = 'all' | FeedbackEntry['rating'];

export function filterFeedbackByRating(entries: readonly FeedbackEntry[], ratingFilter: RatingFilter): FeedbackEntry[] {
  return ratingFilter === 'all' ? [...entries] : entries.filter((entry) => entry.rating === ratingFilter);
}

export function countRatings(entries: readonly FeedbackEntry[]): { up: number; down: number; withComment: number } {
  return {
    up: entries.filter((entry) => entry.rating === 'up').length,
    down: entries.filter((entry) => entry.rating === 'down').length,
    withComment: entries.filter((entry) => entry.comment !== null && entry.comment.trim() !== '').length,
  };
}

/** Opens the conversation scrolled to the rated message. */
export function ratedMessageLink(entry: Pick<FeedbackEntry, 'conversationId' | 'messageId'>): string {
  return `${conversationPath(entry.conversationId)}#${messageAnchorId(entry.messageId)}`;
}
