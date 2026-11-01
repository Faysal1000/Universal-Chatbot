import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { ChatbotSettingsAdminController } from './chatbot-settings-admin.controller.js';
import { ChatbotSettingsModule } from './chatbot-settings.module.js';

@Module({ imports: [AdminAuthModule, ChatbotSettingsModule], controllers: [ChatbotSettingsAdminController] })
export class ChatbotSettingsAdminModule {}
