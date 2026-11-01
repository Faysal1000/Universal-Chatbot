import { Injectable } from '@nestjs/common';

import {
  type ChatbotSettingsRecord,
  ChatbotSettingsRepository,
  type NewChatbotSettingsRecord,
} from './chatbot-settings.repository.js';

/** Settings change rarely and are read on every turn; a short cache spares the database. */
const ACTIVE_SETTINGS_CACHE_MILLISECONDS = 5_000;

/** The active chatbot settings version (migration 0004 seeds version 1). */
@Injectable()
export class ChatbotSettingsService {
  private cachedSettings: { readonly settings: ChatbotSettingsRecord; readonly loadedAt: number } | undefined;

  constructor(private readonly chatbotSettingsRepository: ChatbotSettingsRepository) {}

  async getActive(): Promise<ChatbotSettingsRecord> {
    if (
      this.cachedSettings !== undefined &&
      Date.now() - this.cachedSettings.loadedAt < ACTIVE_SETTINGS_CACHE_MILLISECONDS
    ) {
      return this.cachedSettings.settings;
    }
    const settings = await this.chatbotSettingsRepository.findActive();
    if (settings === undefined) throw new Error('No active chatbot settings version exists');
    this.cachedSettings = { settings, loadedAt: Date.now() };
    return settings;
  }

  async saveNewVersion(settings: NewChatbotSettingsRecord): Promise<ChatbotSettingsRecord> {
    const saved = await this.chatbotSettingsRepository.insertActiveVersion(settings);
    this.cachedSettings = undefined;
    return saved;
  }

  async activate(version: number): Promise<void> {
    await this.chatbotSettingsRepository.activate(version);
    this.cachedSettings = undefined;
  }
}
