import { describe, expect, it } from 'vitest';

import type { ChatMessage, Citation, TurnStreamEvent } from '@chat-core/api/chatApiContract';
import { ChatApiError } from '@chat-core/api/chatApiError';

import {
  applyStreamEventToTurn,
  buildTurnsFromHistory,
  createWaitingReply,
  isEmptyAnswer,
  mergeSupersededTurn,
  prependHistoryPage,
  refreshAttachments,
  replyErrorFrom,
  type TurnView,
} from './chatThreadModel';

const baseTurn: TurnView = {
  turnId: 't1',
  userMessages: [
    {
      clientMessageId: 'c1',
      serverId: null,
      content: 'hi',
      attachments: [],
      createdAt: '2026-01-01T00:00:00Z',
    },
  ],
  reply: createWaitingReply(),
};

function apply(events: TurnStreamEvent[], now = 1000): TurnView {
  return events.reduce(
    (turn, event, index) => applyStreamEventToTurn(turn, event, now + index * 1000),
    baseTurn,
  );
}

const citation = (id: string, marker: number): Citation => ({
  id,
  marker,
  kind: 'text',
  documentId: 'd',
  documentTitle: 'Doc',
  page: 1,
  snippet: '',
  bbox: null,
  hasPreview: false,
});

describe('applyStreamEventToTurn', () => {
  it('walks a reply through waiting → thinking → answering → complete', () => {
    const started = apply([
      {
        type: 'message.started',
        eventId: '1',
        data: {
          turnId: 't1',
          conversationId: 'c',
          assistantMessageId: 'a1',
          userMessages: [{ clientMessageId: 'c1', id: 'u1' }],
        },
      },
    ]);
    expect(started.reply.phase).toBe('waiting');
    expect(started.userMessages[0]?.serverId).toBe('u1');

    const done = apply([
      { type: 'status', eventId: '2', data: { stage: 'retrieving' } },
      { type: 'reasoning.delta', eventId: '3', data: { text: 'Let me ' } },
      { type: 'reasoning.delta', eventId: '4', data: { text: 'think.' } },
      { type: 'answer.delta', eventId: '5', data: { text: 'Hello' } },
      { type: 'answer.delta', eventId: '6', data: { text: ' world' } },
      {
        type: 'message.completed',
        eventId: '7',
        data: {
          assistantMessageId: 'a1',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 2 },
          timings: { ttftMs: 1, totalMs: 2 },
        },
      },
    ]);
    expect(done.reply).toMatchObject({
      phase: 'complete',
      content: 'Hello world',
      reasoning: 'Let me think.',
      reasoningStartedAt: 2000,
      reasoningEndedAt: 4000,
      stage: null,
      serverId: 'a1',
    });
  });

  it('marks a cancelled completion as stopped and keeps the partial answer', () => {
    const turn = apply([
      { type: 'answer.delta', eventId: '1', data: { text: 'Partial' } },
      {
        type: 'message.completed',
        eventId: '2',
        data: {
          assistantMessageId: 'a1',
          finishReason: 'cancelled',
          usage: { inputTokens: 0, outputTokens: 0 },
          timings: { ttftMs: 0, totalMs: 0 },
        },
      },
    ]);
    expect(turn.reply.phase).toBe('stopped');
    expect(turn.reply.content).toBe('Partial');
  });

  it('merges incremental citations by id and keeps marker order', () => {
    const turn = apply([
      { type: 'answer.citations', eventId: '1', data: { citations: [citation('b', 2)] } },
      { type: 'answer.citations', eventId: '2', data: { citations: [citation('a', 1), citation('b', 2)] } },
    ]);
    expect(turn.reply.citations.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('records stream errors with a retry deadline', () => {
    const turn = apply([
      {
        type: 'error',
        eventId: '1',
        data: { code: 'upstream_failed', message: 'Model down', retryable: true, retryAfterSeconds: 5 },
      },
    ]);
    expect(turn.reply.phase).toBe('error');
    expect(turn.reply.error).toMatchObject({ message: 'Model down', retryable: true, retryNotBefore: 6000 });
  });
});

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'm',
  turnId: 't',
  role: 'user',
  content: '',
  attachments: [],
  citations: [],
  reasoning: null,
  status: 'complete',
  createdAt: '2026-01-01T00:00:00Z',
  feedback: null,
  ...overrides,
});

describe('buildTurnsFromHistory', () => {
  it('groups a batch of user messages and its single reply into one turn', () => {
    const turns = buildTurnsFromHistory([
      message({ id: 'u1', turnId: 't1', content: 'first' }),
      message({ id: 'u2', turnId: 't1', content: 'second' }),
      message({ id: 'a1', turnId: 't1', role: 'assistant', content: 'answer', feedback: 'up' }),
      message({ id: 'u3', turnId: 't2', content: 'next' }),
      message({ id: 'a2', turnId: 't2', role: 'assistant', content: 'partial', status: 'stopped' }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.userMessages.map((m) => m.content)).toEqual(['first', 'second']);
    expect(turns[0]?.reply).toMatchObject({ content: 'answer', phase: 'complete', feedback: 'up' });
    expect(turns[1]?.reply.phase).toBe('stopped');
  });

  it('flags a trailing turn without a reply so the controller can try to resume it', () => {
    const turns = buildTurnsFromHistory([message({ id: 'u1', turnId: 't1', content: 'q' })]);
    expect(turns[0]?.reply.serverId).toBeNull();
    expect(turns[0]?.reply.phase).toBe('error');
  });
});

describe('prependHistoryPage', () => {
  it('stitches a turn whose user messages straddle the page boundary', () => {
    const newestPage = buildTurnsFromHistory([
      message({ id: 'u2', turnId: 't1', content: 'second' }),
      message({ id: 'a1', turnId: 't1', role: 'assistant', content: 'answer' }),
    ]);
    const turns = prependHistoryPage(newestPage, [
      message({ id: 'u0', turnId: 't0', content: 'older' }),
      message({ id: 'a0', turnId: 't0', role: 'assistant', content: 'older answer' }),
      message({ id: 'u1', turnId: 't1', content: 'first' }),
    ]);
    expect(turns.map((t) => t.turnId)).toEqual(['t0', 't1']);
    expect(turns[1]?.userMessages.map((m) => m.content)).toEqual(['first', 'second']);
    expect(turns[1]?.reply.content).toBe('answer');
  });

  it('simply prepends whole older turns', () => {
    const newestPage = buildTurnsFromHistory([message({ id: 'u1', turnId: 't1' })]);
    const turns = prependHistoryPage(newestPage, [message({ id: 'u0', turnId: 't0' })]);
    expect(turns.map((t) => t.turnId)).toEqual(['t0', 't1']);
  });
});

describe('mergeSupersededTurn', () => {
  const turn = (turnId: string, content: string): TurnView => ({
    ...baseTurn,
    turnId,
    userMessages: [{ ...baseTurn.userMessages[0]!, clientMessageId: content, content }],
  });

  it('moves the superseded messages in front of a superseding turn the page already shows', () => {
    const merged = mergeSupersededTurn([turn('old', 'first'), turn('new', 'second')], 'old', 'new');
    expect(merged.supersedingTurnIsKnown).toBe(true);
    expect(merged.turns).toHaveLength(1);
    expect(merged.turns[0]?.userMessages.map((m) => m.content)).toEqual(['first', 'second']);
  });

  it('renames the turn and restarts its reply when the superseding turn came from elsewhere', () => {
    const merged = mergeSupersededTurn([turn('old', 'first')], 'old', 'other-tab');
    expect(merged.supersedingTurnIsKnown).toBe(false);
    expect(merged.turns[0]?.turnId).toBe('other-tab');
    expect(merged.turns[0]?.reply.phase).toBe('waiting');
  });
});

describe('refreshAttachments', () => {
  it('swaps in fresh signed URLs by attachment id', () => {
    const attachment = {
      id: 'att',
      mimeType: 'image/png',
      sizeBytes: 1,
      width: 1,
      height: 1,
      url: '/old',
      expiresAt: '',
    };
    const turns: TurnView[] = [
      { ...baseTurn, userMessages: [{ ...baseTurn.userMessages[0]!, attachments: [attachment] }] },
    ];
    const refreshed = refreshAttachments(turns, new Map([['att', { ...attachment, url: '/fresh' }]]));
    expect(refreshed[0]?.userMessages[0]?.attachments[0]?.url).toBe('/fresh');
  });
});

describe('replyErrorFrom', () => {
  it('keeps the request id and makes a non-replaceable turn final', () => {
    const error = new ChatApiError('conflict', 'Only the latest turn', {
      status: 409,
      code: 'turn_not_replaceable',
      requestId: 'req-1',
    });
    expect(replyErrorFrom(error, 0)).toMatchObject({
      code: 'turn_not_replaceable',
      retryable: false,
      requestId: 'req-1',
    });
  });

  it('turns a Retry-After into the earliest retry time', () => {
    const error = new ChatApiError('rate_limited', 'slow down', { retryAfterMs: 5000 });
    expect(replyErrorFrom(error, 1000)).toMatchObject({ retryable: true, retryNotBefore: 6000 });
  });
});

describe('isEmptyAnswer', () => {
  const finished = (content: string, finishReason: 'stop' | 'length' | 'no_evidence') => ({
    ...createWaitingReply(),
    phase: 'complete' as const,
    content,
    finishReason,
  });

  it('flags a completed reply without text', () => {
    expect(isEmptyAnswer(finished('  ', 'length'))).toBe(true);
  });

  it('accepts answers and the no-evidence fallback', () => {
    expect(isEmptyAnswer(finished('Opens at 08:15.', 'stop'))).toBe(false);
    expect(isEmptyAnswer(finished('', 'no_evidence'))).toBe(false);
  });
});
