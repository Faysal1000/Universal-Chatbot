import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { discardDeadLetter, listDeadLetters, listQueues, retryDeadLetter } from './operationsApi';
import { operationsQueryKeys } from './operationsQueryKeys';

/** Queue counts move constantly; the page keeps them fresh while it is open. */
export const OPERATIONS_POLL_MILLISECONDS = 10_000;

export function useQueues() {
  return useQuery({
    queryKey: operationsQueryKeys.queues,
    queryFn: listQueues,
    refetchInterval: OPERATIONS_POLL_MILLISECONDS,
  });
}

export function useDeadLetters(offset: number) {
  return useQuery({
    queryKey: operationsQueryKeys.deadLetterPage(offset),
    queryFn: () => listDeadLetters(offset),
    placeholderData: keepPreviousData,
    refetchInterval: OPERATIONS_POLL_MILLISECONDS,
  });
}

function useInvalidateOperations() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: operationsQueryKeys.deadLetters }),
      queryClient.invalidateQueries({ queryKey: operationsQueryKeys.queues }),
    ]);
}

export function useRetryDeadLetter() {
  const invalidateOperations = useInvalidateOperations();
  return useMutation({ mutationFn: retryDeadLetter, onSuccess: invalidateOperations });
}

export function useDiscardDeadLetter() {
  const invalidateOperations = useInvalidateOperations();
  return useMutation({ mutationFn: discardDeadLetter, onSuccess: invalidateOperations });
}
