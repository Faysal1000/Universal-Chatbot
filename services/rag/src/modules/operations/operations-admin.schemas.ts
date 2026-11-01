import { z } from 'zod';

const jobCountsSchema = z.object({
  waiting: z.number().int(),
  active: z.number().int(),
  delayed: z.number().int(),
  failed: z.number().int(),
  completed: z.number().int(),
});

export const queueSummarySchema = z.object({
  queueName: z.string(),
  consumer: z.enum(['rag-worker', 'document-parser', 'none']),
  isPaused: z.boolean(),
  counts: jobCountsSchema,
});

export const deadLetterListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const deadLetterIdParameterSchema = z.string().min(1).max(300);

export const deadLetterSchema = z.object({
  id: z.string(),
  originalQueueName: z.string(),
  originalJobId: z.string().nullable(),
  originalJobName: z.string(),
  failureCode: z.string(),
  failureMessage: z.string(),
  failedAt: z.iso.datetime(),
  attemptsMade: z.number().int(),
  payload: z.unknown().describe('The job envelope as it was queued'),
});
export type DeadLetterView = z.infer<typeof deadLetterSchema>;

export const deadLetterPageSchema = z.object({
  items: z.array(deadLetterSchema),
  total: z.number().int(),
});

export const deadLetterRetrySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('document_reprocessed'), documentId: z.uuid(), ingestionRunId: z.uuid() }),
  z.object({ action: z.literal('job_retried'), queueName: z.string(), jobId: z.string() }),
]);
