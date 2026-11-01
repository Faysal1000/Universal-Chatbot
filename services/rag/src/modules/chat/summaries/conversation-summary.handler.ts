import { Injectable } from '@nestjs/common';

import type { JobContext, QueueJobHandler } from '../../../queue/queue-job-handler.js';
import { QUEUE_NAMES } from '../../../queue/queue-names.js';
import { ConversationSummaryService } from './conversation-summary.service.js';
import { type SummariseConversationPayload, summariseConversationPayloadSchema } from './summary-jobs.js';

/** Summaries are best-effort: a failure only means prompts keep dropping old turns. */
@Injectable()
export class ConversationSummaryHandler implements QueueJobHandler<SummariseConversationPayload> {
  readonly queueName = QUEUE_NAMES.conversationSummary;
  readonly payloadSchema = summariseConversationPayloadSchema;
  // One CPU-bound model call at a time leaves the gateway free for live answers.
  readonly concurrency = 1;

  constructor(private readonly conversationSummary: ConversationSummaryService) {}

  async handle({ payload, requestId }: JobContext<SummariseConversationPayload>): Promise<void> {
    await this.conversationSummary.summarise(payload, requestId);
  }
}
