import { requestRagApi } from '@/shared/api/httpClient';

import type { FeedbackEntry, FeedbackLimit } from './feedbackTypes';

export function listFeedback(limit: FeedbackLimit): Promise<FeedbackEntry[]> {
  return requestRagApi<FeedbackEntry[]>('/feedback', { queryParameters: { limit } });
}

export function deleteFeedback(messageId: string): Promise<void> {
  return requestRagApi<undefined>(`/feedback/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
}
