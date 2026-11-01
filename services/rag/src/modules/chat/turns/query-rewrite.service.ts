import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { ServiceConfiguration } from '../../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../../config/configuration.module.js';
import type { HistoryTurn } from '../../../domain/chat/conversation-memory-planner.js';
import { TokenEstimator } from '../../../domain/text/token-estimator.js';
import { LANGUAGE_MODEL_PORT, type LanguageModelPort } from '../../../ports/language-model.port.js';

const QUERY_REWRITE_TASK = 'query_rewrite';
const MAXIMUM_SEARCH_QUERIES = 3;
/** Recent context the rewriter sees; older turns rarely change what a follow-up means. */
const CONTEXT_TURN_COUNT = 3;
const CONTEXT_MESSAGE_TOKENS = 300;
const REWRITE_OUTPUT_TOKENS = 200;
/** Keeps the visitor's own words, searched when rewriting fails, within the embedding server's input limit. */
const FALLBACK_QUERY_TOKENS = 1_000;

const rewriteResultSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(500)).min(1),
});

const REWRITE_INSTRUCTIONS = [
  "You turn a website visitor's latest messages into standalone search queries for a document search engine.",
  '- Resolve pronouns and references using the earlier conversation ("it", "that policy", "and for managers?").',
  '- Rewrite only the latest messages. The earlier conversation is context, not something to search again.',
  `- Return 1 to ${MAXIMUM_SEARCH_QUERIES} different queries: one per distinct question in the latest messages.`,
  '- Keep the language of the visitor. Do not answer the question.',
  'Reply with JSON only, exactly like {"queries": ["..."]}.',
].join('\n');

export interface QueryRewriteRequest {
  readonly recentTurns: readonly HistoryTurn[];
  readonly currentMessageTexts: readonly string[];
  readonly requestId: string | undefined;
  readonly abortSignal: AbortSignal;
}

/**
 * Rewrites the visitor's batch into standalone search queries with the gateway task
 * `query_rewrite`. It never blocks an answer: on a slow or failed rewrite the visitor's
 * own words are searched.
 */
@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);

  constructor(
    private readonly tokenEstimator: TokenEstimator,
    @Inject(LANGUAGE_MODEL_PORT) private readonly languageModel: LanguageModelPort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  /** A first, single question needs no context resolution, so it is searched as typed. */
  needsRewriting(request: Pick<QueryRewriteRequest, 'recentTurns' | 'currentMessageTexts'>): boolean {
    return request.recentTurns.length > 0 || request.currentMessageTexts.length > 1;
  }

  async rewrite(request: QueryRewriteRequest): Promise<string[]> {
    const fallbackQueries = [
      this.tokenEstimator.truncate(request.currentMessageTexts.join('\n'), FALLBACK_QUERY_TOKENS),
    ];
    if (!this.needsRewriting(request)) return fallbackQueries;
    const timeoutSignal = AbortSignal.timeout(this.configuration.llmGateway.queryRewriteTimeoutMilliseconds);
    try {
      const completion = await this.languageModel.complete(
        {
          task: QUERY_REWRITE_TASK,
          messages: [
            { role: 'system', content: REWRITE_INSTRUCTIONS },
            { role: 'user', content: this.describeConversation(request) },
          ],
          maxOutputTokens: REWRITE_OUTPUT_TOKENS,
          temperature: 0,
          ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        },
        AbortSignal.any([request.abortSignal, timeoutSignal]),
      );
      return parseQueries(completion.content) ?? fallbackQueries;
    } catch (error: unknown) {
      if (request.abortSignal.aborted) throw error;
      this.logger.warn({ err: error }, 'Query rewriting failed; searching the original messages');
      return fallbackQueries;
    }
  }

  private describeConversation(request: QueryRewriteRequest): string {
    const contextLines = request.recentTurns
      .slice(-CONTEXT_TURN_COUNT)
      .flatMap((turn) =>
        turn.messages.map(
          (message) =>
            `${message.role === 'user' ? 'Visitor' : 'Assistant'}: ${this.tokenEstimator.truncate(message.content, CONTEXT_MESSAGE_TOKENS)}`,
        ),
      );
    const currentLines = request.currentMessageTexts.map((text) => `Visitor: ${text}`);
    return [
      contextLines.length === 0
        ? 'Earlier conversation: (none)'
        : `Earlier conversation:\n${contextLines.join('\n')}`,
      `Latest messages:\n${currentLines.join('\n')}`,
    ].join('\n\n');
  }
}

/** Accepts the JSON object alone or wrapped in prose or a code fence. */
function parseQueries(modelOutput: string): string[] | undefined {
  const jsonText = /\{[\s\S]*\}/.exec(modelOutput)?.[0];
  if (jsonText === undefined) return undefined;
  try {
    const result = rewriteResultSchema.safeParse(JSON.parse(jsonText));
    return result.success ? distinctQueries(result.data.queries) : undefined;
  } catch {
    return undefined;
  }
}

/** Small models repeat themselves; each distinct query is searched once. */
function distinctQueries(queries: readonly string[]): string[] {
  const seenKeys = new Set<string>();
  const firstOccurrences = queries.filter((query) => {
    const key = query.toLocaleLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  return firstOccurrences.slice(0, MAXIMUM_SEARCH_QUERIES);
}
