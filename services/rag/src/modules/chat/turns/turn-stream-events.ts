/**
 * SSE events of a turn (public chat API v1). The chat clients validate them with the zod
 * schemas in `chat-core/api/chatApiContract.ts` of frontend-chat-interface.
 */
export interface CitationView {
  readonly id: string;
  readonly marker: number;
  readonly kind: 'text' | 'visual';
  readonly documentId: string;
  readonly documentTitle: string;
  readonly page: number;
  readonly snippet: string;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  readonly hasPreview: boolean;
}

export interface ConversationView {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessagePreview: string | null;
}

export type TurnStage = 'queued' | 'rewriting' | 'retrieving' | 'generating';
export type TurnFinishReason = 'stop' | 'length' | 'no_evidence' | 'cancelled';

export interface TurnStreamEventPayloads {
  'message.started': {
    readonly turnId: string;
    readonly conversationId: string;
    readonly assistantMessageId: string;
    readonly userMessages: readonly { readonly clientMessageId: string; readonly id: string }[];
  };
  status: { readonly stage: TurnStage; readonly label?: string };
  'reasoning.delta': { readonly text: string };
  'answer.delta': { readonly text: string };
  'answer.citations': { readonly citations: readonly CitationView[] };
  'conversation.updated': { readonly conversation: ConversationView };
  'turn.superseded': { readonly supersededByTurnId: string };
  'message.completed': {
    readonly assistantMessageId: string;
    readonly finishReason: TurnFinishReason;
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    readonly timings: { readonly ttftMs: number; readonly totalMs: number };
  };
  error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly retryAfterSeconds?: number;
  };
}

export type TurnStreamEventName = keyof TurnStreamEventPayloads;

export interface TurnStreamEvent {
  /** Monotonic per turn, starting at 1; clients resume with `Last-Event-ID`. */
  readonly sequence: number;
  readonly name: TurnStreamEventName;
  readonly data: unknown;
}

/** After one of these the stream closes. */
export const TERMINAL_TURN_EVENTS: ReadonlySet<TurnStreamEventName> = new Set([
  'message.completed',
  'error',
  'turn.superseded',
]);
