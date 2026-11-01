import type { operations } from '@/contracts/rag';

export type QueueSummary =
  operations['OperationsAdminController_listQueues']['responses'][200]['content']['application/json'][number];
export type QueueConsumer = QueueSummary['consumer'];
export type DeadLetterPage =
  operations['OperationsAdminController_listDeadLetters']['responses'][200]['content']['application/json'];
export type DeadLetter = DeadLetterPage['items'][number];
export type DeadLetterRetryOutcome =
  operations['OperationsAdminController_retryDeadLetter']['responses'][202]['content']['application/json'];

export const DEAD_LETTER_PAGE_SIZE = 25;
