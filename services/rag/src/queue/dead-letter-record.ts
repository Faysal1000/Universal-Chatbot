/** What the dead-letter queue keeps about a job that will not be retried again. */
export interface DeadLetterRecord {
  readonly originalQueueName: string;
  readonly originalJobId: string | undefined;
  readonly originalJobName: string;
  readonly payload: unknown;
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly failedAt: string;
  readonly attemptsMade: number;
}
