import { Module } from '@nestjs/common';

import { TurnstileAdapter } from '../../infrastructure/turnstile/turnstile.adapter.js';
import { HUMAN_VERIFICATION_PORT } from '../../ports/human-verification.port.js';
import { ChatbotSettingsModule } from '../chatbot-settings/chatbot-settings.module.js';
import { WidgetKeysModule } from '../widget-keys/widget-keys.module.js';
import { ClientBlocksRepository } from './client-blocks.repository.js';
import { ClientIdentityHasher } from './client-identity-hasher.js';
import { DailyTokenBudgetService } from './daily-token-budget.service.js';
import { PublicConfigController } from './public-config.controller.js';
import { PublicRateLimitsService } from './public-rate-limits.service.js';
import { VisitorAuthenticationGuard } from './visitor-authentication.guard.js';
import { VisitorSessionsRepository } from './visitor-sessions.repository.js';
import { VisitorSessionsService } from './visitor-sessions.service.js';

/** Who may use the public chat, and how much: sessions, Turnstile, blocks, limits, budget. */
@Module({
  imports: [ChatbotSettingsModule, WidgetKeysModule],
  controllers: [PublicConfigController],
  providers: [
    { provide: HUMAN_VERIFICATION_PORT, useClass: TurnstileAdapter },
    ClientIdentityHasher,
    ClientBlocksRepository,
    VisitorSessionsRepository,
    VisitorSessionsService,
    PublicRateLimitsService,
    DailyTokenBudgetService,
    VisitorAuthenticationGuard,
  ],
  exports: [
    VisitorAuthenticationGuard,
    VisitorSessionsService,
    PublicRateLimitsService,
    DailyTokenBudgetService,
    ClientBlocksRepository,
    ClientIdentityHasher,
    VisitorSessionsRepository,
  ],
})
export class PublicAccessModule {}
