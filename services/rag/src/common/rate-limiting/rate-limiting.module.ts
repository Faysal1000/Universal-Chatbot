import { Global, Module } from '@nestjs/common';

import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter.js';

@Global()
@Module({ providers: [SlidingWindowRateLimiter], exports: [SlidingWindowRateLimiter] })
export class RateLimitingModule {}
