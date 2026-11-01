import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { listFeedback } from './feedbackApi';
import { feedbackQueryKeys } from './feedbackQueryKeys';
import type { FeedbackLimit } from './feedbackTypes';

export function useRecentFeedback(limit: FeedbackLimit) {
  return useQuery({
    queryKey: feedbackQueryKeys.recent(limit),
    queryFn: () => listFeedback(limit),
    placeholderData: keepPreviousData,
  });
}
