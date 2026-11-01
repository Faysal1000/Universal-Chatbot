import { requestRagApi } from '@/shared/api/httpClient';

import { DEAD_LETTER_PAGE_SIZE } from './operationsTypes';
import type { DeadLetterPage, DeadLetterRetryOutcome, QueueSummary } from './operationsTypes';

export function listQueues(): Promise<QueueSummary[]> {
  return requestRagApi<QueueSummary[]>('/queues');
}

export function listDeadLetters(offset: number): Promise<DeadLetterPage> {
  return requestRagApi<DeadLetterPage>('/dead-letters', { queryParameters: { offset, limit: DEAD_LETTER_PAGE_SIZE } });
}

export function retryDeadLetter(deadLetterId: string): Promise<DeadLetterRetryOutcome> {
  return requestRagApi<DeadLetterRetryOutcome>(`/dead-letters/${encodeURIComponent(deadLetterId)}/retry`, {
    method: 'POST',
  });
}

export function discardDeadLetter(deadLetterId: string): Promise<void> {
  return requestRagApi<undefined>(`/dead-letters/${encodeURIComponent(deadLetterId)}`, { method: 'DELETE' });
}
