import { EventEmitter } from 'node:events';

import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.tokens.js';
import {
  TERMINAL_TURN_EVENTS,
  type TurnStreamEvent,
  type TurnStreamEventName,
  type TurnStreamEventPayloads,
} from './turn-stream-events.js';

/** Buffered events outlive the turn this long, for resumes after a dropped connection. */
const EVENT_BUFFER_TTL_SECONDS = 10 * 60;
/** Readers on another api replica than the writer notice new events within this time. */
const CROSS_PROCESS_POLL_MILLISECONDS = 500;

/**
 * Append-only event log of each turn in a Redis stream. Every SSE response (the first
 * one, a resume, an idempotent replay) is a reader of this log, so they all see the same
 * events with the same ids. In-process readers are woken immediately; others poll.
 */
@Injectable()
export class TurnEventLog {
  private readonly appended = new EventEmitter().setMaxListeners(0);
  private readonly nextSequenceByTurn = new Map<string, number>();

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async append<Name extends TurnStreamEventName>(
    turnId: string,
    name: Name,
    data: TurnStreamEventPayloads[Name],
  ): Promise<void> {
    const sequence = this.nextSequenceByTurn.get(turnId) ?? 1;
    this.nextSequenceByTurn.set(turnId, sequence + 1);
    const key = streamKey(turnId);
    await this.redisClient
      .multi()
      .xadd(key, `${sequence}-0`, 'name', name, 'data', JSON.stringify(data))
      .expire(key, EVENT_BUFFER_TTL_SECONDS)
      .exec();
    if (TERMINAL_TURN_EVENTS.has(name)) this.nextSequenceByTurn.delete(turnId);
    this.appended.emit(turnId);
  }

  async exists(turnId: string): Promise<boolean> {
    return (await this.redisClient.exists(streamKey(turnId))) === 1;
  }

  /** Yields events after `afterSequence` until a terminal event or the signal aborts. */
  async *read(
    turnId: string,
    afterSequence: number,
    abortSignal: AbortSignal,
  ): AsyncGenerator<TurnStreamEvent> {
    let lastSequence = afterSequence;
    while (!abortSignal.aborted) {
      const entries = await this.redisClient.xrange(streamKey(turnId), `(${lastSequence}-0`, '+');
      for (const [entryId, fields] of entries) {
        const event = toTurnStreamEvent(entryId, fields);
        lastSequence = event.sequence;
        yield event;
        if (TERMINAL_TURN_EVENTS.has(event.name)) return;
      }
      await this.waitForAppend(turnId, abortSignal);
    }
  }

  private waitForAppend(turnId: string, abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(pollTimer);
        this.appended.off(turnId, finish);
        abortSignal.removeEventListener('abort', finish);
        resolve();
      };
      const pollTimer = setTimeout(finish, CROSS_PROCESS_POLL_MILLISECONDS);
      this.appended.on(turnId, finish);
      abortSignal.addEventListener('abort', finish, { once: true });
    });
  }
}

function streamKey(turnId: string): string {
  return `turn-events:${turnId}`;
}

function toTurnStreamEvent(entryId: string, fields: string[]): TurnStreamEvent {
  const fieldValues = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    fieldValues.set(fields[index] ?? '', fields[index + 1] ?? '');
  }
  return {
    sequence: Number(entryId.split('-')[0]),
    name: fieldValues.get('name') as TurnStreamEventName,
    data: JSON.parse(fieldValues.get('data') ?? 'null') as unknown,
  };
}
