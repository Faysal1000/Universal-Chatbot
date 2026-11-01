import type {
  Attachment,
  ChatMessage,
  Citation,
  FeedbackRating,
  FinishReason,
  RetrievalStage,
  TurnStreamEvent,
} from '@chat-core/api/chatApiContract';
import { API_ERROR_CODES } from '@chat-core/api/chatApiContract';
import { ChatApiError, errorKindFromCode, type ChatApiErrorKind } from '@chat-core/api/chatApiError';

/** Key of the not-yet-created conversation shown at "/" (created on its first flush). */
export const DRAFT_CONVERSATION_KEY = '__draft__';

/**
 * Lifecycle of an assistant reply as the user sees it:
 * waiting (orb, retrieval stages) → thinking (reasoning stream) → answering (answer tokens) → complete | stopped | error
 */
export type ReplyPhase = 'waiting' | 'thinking' | 'answering' | 'complete' | 'stopped' | 'error';

export interface ReplyError {
  kind: ChatApiErrorKind;
  /** Machine-readable API error code (e.g. `turn_not_replaceable`), when the server sent one. */
  code: string | null;
  message: string;
  retryable: boolean;
  /** Epoch ms before which a retry is pointless (429/503 `Retry-After`). */
  retryNotBefore: number | null;
  /** Server request id, shown so users can quote it to support. */
  requestId: string | null;
}

export interface UserMessageView {
  clientMessageId: string;
  serverId: string | null;
  content: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface AssistantReplyView {
  serverId: string | null;
  content: string;
  reasoning: string;
  reasoningStartedAt: number | null;
  reasoningEndedAt: number | null;
  citations: Citation[];
  phase: ReplyPhase;
  stage: RetrievalStage | null;
  finishReason: FinishReason | null;
  error: ReplyError | null;
  feedback: FeedbackRating | null;
  isReconnecting: boolean;
}

export interface TurnView {
  turnId: string;
  userMessages: UserMessageView[];
  reply: AssistantReplyView;
}

/** A message the user sent that is still inside the batching quiet window. */
export interface PendingUserMessage {
  clientMessageId: string;
  content: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface ThreadState {
  turns: TurnView[];
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Cursor for the next older history page; null when the beginning of the conversation is loaded. */
  olderCursor: string | null;
  olderStatus: 'idle' | 'loading' | 'error';
}

export const EMPTY_THREAD: ThreadState = {
  turns: [],
  loadStatus: 'idle',
  olderCursor: null,
  olderStatus: 'idle',
};

const TERMINAL_REPLY_PHASES: readonly ReplyPhase[] = ['complete', 'stopped', 'error'];

export function isReplyInFlight(reply: AssistantReplyView): boolean {
  return !TERMINAL_REPLY_PHASES.includes(reply.phase);
}

/**
 * A reply that finished without visible text, e.g. a small model that spent its whole token budget reasoning.
 * The UI says so; otherwise the turn would look broken.
 */
export function isEmptyAnswer(reply: AssistantReplyView): boolean {
  return reply.phase === 'complete' && reply.content.trim() === '' && reply.finishReason !== 'no_evidence';
}

export function createWaitingReply(): AssistantReplyView {
  return {
    serverId: null,
    content: '',
    reasoning: '',
    reasoningStartedAt: null,
    reasoningEndedAt: null,
    citations: [],
    phase: 'waiting',
    stage: null,
    finishReason: null,
    error: null,
    feedback: null,
    isReconnecting: false,
  };
}

/** Pure reducer: applies one SSE event to a turn. `now` is injected for deterministic tests. */
export function applyStreamEventToTurn(turn: TurnView, event: TurnStreamEvent, now: number): TurnView {
  const reply = turn.reply;
  switch (event.type) {
    case 'message.started': {
      const serverIds = new Map(event.data.userMessages.map((m) => [m.clientMessageId, m.id]));
      return {
        ...turn,
        userMessages: turn.userMessages.map((m) => ({
          ...m,
          serverId: serverIds.get(m.clientMessageId) ?? m.serverId,
        })),
        reply: { ...reply, serverId: event.data.assistantMessageId, isReconnecting: false },
      };
    }
    case 'status':
      return { ...turn, reply: { ...reply, stage: event.data.stage } };
    case 'reasoning.delta':
      return {
        ...turn,
        reply: {
          ...reply,
          phase: reply.phase === 'answering' ? 'answering' : 'thinking',
          reasoning: reply.reasoning + event.data.text,
          reasoningStartedAt: reply.reasoningStartedAt ?? now,
        },
      };
    case 'answer.delta':
      return {
        ...turn,
        reply: {
          ...reply,
          phase: 'answering',
          content: reply.content + event.data.text,
          reasoningEndedAt: reply.reasoningStartedAt !== null ? (reply.reasoningEndedAt ?? now) : null,
        },
      };
    case 'answer.citations': {
      const byId = new Map(reply.citations.map((c) => [c.id, c]));
      for (const citation of event.data.citations) byId.set(citation.id, citation);
      return {
        ...turn,
        reply: { ...reply, citations: [...byId.values()].sort((a, b) => a.marker - b.marker) },
      };
    }
    case 'message.completed':
      return {
        ...turn,
        reply: {
          ...reply,
          serverId: event.data.assistantMessageId,
          phase: event.data.finishReason === 'cancelled' ? 'stopped' : 'complete',
          finishReason: event.data.finishReason,
          stage: null,
          isReconnecting: false,
          reasoningEndedAt: reply.reasoningStartedAt !== null ? (reply.reasoningEndedAt ?? now) : null,
        },
      };
    case 'error':
      return {
        ...turn,
        reply: {
          ...reply,
          phase: 'error',
          stage: null,
          isReconnecting: false,
          error: {
            kind: errorKindFromCode(event.data.code),
            code: event.data.code,
            message: event.data.message,
            retryable: event.data.retryable,
            retryNotBefore:
              event.data.retryAfterSeconds === undefined ? null : now + event.data.retryAfterSeconds * 1000,
            requestId: null,
          },
        },
      };
    case 'conversation.updated':
      return turn;
    case 'turn.superseded':
      // Thread-level: the runner moves this turn's messages into the superseding turn (mergeSupersededTurn).
      return turn;
  }
}

/** Normalises any failure into what the reply's error notice needs. */
export function replyErrorFrom(error: unknown, now: number): ReplyError {
  if (!(error instanceof ChatApiError)) return localReplyError('server', 'Something went wrong.');
  const isNotReplaceable = error.code === API_ERROR_CODES.turnNotReplaceable;
  return {
    kind: error.kind,
    code: error.code ?? null,
    message: error.message,
    // `turn_in_progress` clears once the other reply ends; a turn that is no longer the latest never will.
    retryable: !isNotReplaceable && (error.isRetryable || error.kind === 'conflict'),
    retryNotBefore: error.retryAfterMs === undefined ? null : now + error.retryAfterMs,
    requestId: error.requestId ?? null,
  };
}

/** A reply that failed in a way the user can act on, without a server round trip. */
export function localReplyError(kind: ChatApiErrorKind, message: string): ReplyError {
  return { kind, code: null, message, retryable: true, retryNotBefore: null, requestId: null };
}

/**
 * The server moved `supersededTurnId`'s messages into `supersedingTurnId` (`turn.superseded`). When the superseding
 * turn is already in the thread, the superseded messages join it (they were sent first); otherwise the turn simply
 * takes the new id, and its reply restarts so the caller can follow the new stream.
 */
export function mergeSupersededTurn(
  turns: readonly TurnView[],
  supersededTurnId: string,
  supersedingTurnId: string,
): { turns: TurnView[]; supersedingTurnIsKnown: boolean } {
  const superseded = turns.find((t) => t.turnId === supersededTurnId);
  if (!superseded) return { turns: [...turns], supersedingTurnIsKnown: true };
  const supersedingTurnIsKnown = turns.some((t) => t.turnId === supersedingTurnId);

  if (!supersedingTurnIsKnown) {
    return {
      supersedingTurnIsKnown,
      turns: turns.map((t) =>
        t === superseded ? { ...t, turnId: supersedingTurnId, reply: createWaitingReply() } : t,
      ),
    };
  }
  return {
    supersedingTurnIsKnown,
    turns: turns
      .filter((t) => t !== superseded)
      .map((t) =>
        t.turnId === supersedingTurnId
          ? { ...t, userMessages: [...superseded.userMessages, ...t.userMessages] }
          : t,
      ),
  };
}

/** Groups persisted messages into turns (N user messages + 1 assistant reply per turn). */
export function buildTurnsFromHistory(messages: readonly ChatMessage[]): TurnView[] {
  const turns: TurnView[] = [];
  const byTurnId = new Map<string, TurnView>();

  for (const message of messages) {
    let turn = byTurnId.get(message.turnId);
    if (!turn) {
      turn = { turnId: message.turnId, userMessages: [], reply: { ...createWaitingReply(), phase: 'error' } };
      turn.reply.error = localReplyError('server', 'No reply was recorded for this message.');
      byTurnId.set(message.turnId, turn);
      turns.push(turn);
    }
    if (message.role === 'user') {
      turn.userMessages.push({
        clientMessageId: message.id,
        serverId: message.id,
        content: message.content,
        attachments: message.attachments,
        createdAt: message.createdAt,
      });
    } else {
      turn.reply = {
        ...createWaitingReply(),
        serverId: message.id,
        content: message.content,
        reasoning: message.reasoning ?? '',
        citations: message.citations,
        phase: message.status,
        finishReason: message.status === 'stopped' ? 'cancelled' : 'stop',
        feedback: message.feedback,
        error: message.status === 'error' ? localReplyError('server', 'This reply failed.') : null,
      };
    }
  }
  return turns;
}

/**
 * Prepends an older history page. A turn can straddle the page boundary: its earlier user messages arrive with
 * the older page while its reply was already loaded, so the boundary turn is stitched back together.
 */
export function prependHistoryPage(
  turns: readonly TurnView[],
  olderMessages: readonly ChatMessage[],
): TurnView[] {
  const olderTurns = buildTurnsFromHistory(olderMessages);
  const boundary = olderTurns.at(-1);
  const first = turns[0];
  if (!boundary || boundary.turnId !== first?.turnId) return [...olderTurns, ...turns];

  const knownIds = new Set(first.userMessages.map((m) => m.serverId));
  const stitched: TurnView = {
    ...first,
    userMessages: [...boundary.userMessages.filter((m) => !knownIds.has(m.serverId)), ...first.userMessages],
  };
  return [...olderTurns.slice(0, -1), stitched, ...turns.slice(1)];
}

/** Replaces attachments (matched by id) with fresh copies, e.g. after their presigned URLs expired. */
export function refreshAttachments(
  turns: readonly TurnView[],
  fresh: ReadonlyMap<string, Attachment>,
): TurnView[] {
  return turns.map((turn) => {
    if (!turn.userMessages.some((m) => m.attachments.some((a) => fresh.has(a.id)))) return turn;
    return {
      ...turn,
      userMessages: turn.userMessages.map((m) => ({
        ...m,
        attachments: m.attachments.map((a) => fresh.get(a.id) ?? a),
      })),
    };
  });
}
