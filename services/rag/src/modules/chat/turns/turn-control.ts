import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.tokens.js';
import type { TurnInterruption } from './turn-interruption.js';

const CONTROL_TTL_SECONDS = 60 * 60;

/**
 * Shared state of running turns, for whichever api replica receives a cancel or a newer
 * turn: whether the answer already started streaming, and a requested interruption.
 */
@Injectable()
export class TurnControl {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async markAnswerStarted(turnId: string): Promise<void> {
    await this.redisClient
      .multi()
      .hset(controlKey(turnId), 'answering', '1')
      .expire(controlKey(turnId), CONTROL_TTL_SECONDS)
      .exec();
  }

  async hasAnswerStarted(turnId: string): Promise<boolean> {
    return (await this.redisClient.hget(controlKey(turnId), 'answering')) === '1';
  }

  async requestInterruption(turnId: string, interruption: TurnInterruption): Promise<void> {
    await this.redisClient
      .multi()
      .hset(controlKey(turnId), 'interruption', JSON.stringify(interruption))
      .expire(controlKey(turnId), CONTROL_TTL_SECONDS)
      .exec();
  }

  async readInterruption(turnId: string): Promise<TurnInterruption | undefined> {
    const interruptionText = await this.redisClient.hget(controlKey(turnId), 'interruption');
    return interruptionText === null ? undefined : (JSON.parse(interruptionText) as TurnInterruption);
  }
}

function controlKey(turnId: string): string {
  return `turn-control:${turnId}`;
}
