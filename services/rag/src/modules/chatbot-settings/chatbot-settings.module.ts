import { Module } from '@nestjs/common';

import { ChatbotSettingsRepository } from './chatbot-settings.repository.js';
import { ChatbotSettingsService } from './chatbot-settings.service.js';

@Module({
  providers: [ChatbotSettingsRepository, ChatbotSettingsService],
  exports: [ChatbotSettingsRepository, ChatbotSettingsService],
})
export class ChatbotSettingsModule {}
