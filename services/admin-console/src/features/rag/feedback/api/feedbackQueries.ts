import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { conversationQueryKeys } from '../../conversations/api/conversationQueryKeys';
import { deleteFeedback, listFeedback } from './feedbackApi';
import { feedbackQueryKeys } from './feedbackQueryKeys';
import type { FeedbackLimit } from './feedbackTypes';

export function useRecentFeedback(limit: FeedbackLimit) {
  return useQuery({
    queryKey: feedbackQueryKeys.recent(limit),
    queryFn: () => listFeedback(limit),
    placeholderData: keepPreviousData,
  });
}

/** Transcripts show each rating, so open conversations refresh too. */
export function useDeleteFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteFeedback(messageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.all });
    },
  });
}
