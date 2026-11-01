import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';

import { ApplicationError } from '../../common/errors/application-error.js';
import { requestIdOf } from '../../common/http/request-identity.js';
import { ApiJsonBody, ApiJsonResponse } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import {
  type AdminPrincipal,
  actingAdminUserId,
  auditActorOf,
  CurrentAdmin,
} from '../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { type ChatbotSettingsRecord, ChatbotSettingsRepository } from './chatbot-settings.repository.js';
import {
  type ChatbotSettingsInput,
  chatbotSettingsInputSchema,
  chatbotSettingsSchema,
  type ChatbotSettingsView,
  settingsVersionParameterSchema,
} from './chatbot-settings.schemas.js';
import { ChatbotSettingsService } from './chatbot-settings.service.js';

const LISTED_VERSIONS = 100;

@ApiTags('Admin: chatbot settings')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/chatbot-settings')
@UseGuards(AdminAuthenticationGuard)
export class ChatbotSettingsAdminController {
  constructor(
    private readonly chatbotSettings: ChatbotSettingsService,
    private readonly chatbotSettingsRepository: ChatbotSettingsRepository,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The active settings version' })
  @ApiJsonResponse(chatbotSettingsSchema)
  async describeActive(): Promise<ChatbotSettingsView> {
    return presentSettings(await this.chatbotSettings.getActive());
  }

  @Put()
  @ApiOperation({
    summary: 'Save settings as a new active version',
    description: 'Earlier versions are kept and can be re-activated.',
  })
  @ApiJsonBody(chatbotSettingsInputSchema)
  @ApiJsonResponse(chatbotSettingsSchema)
  async save(
    @Body(new ZodValidationPipe(chatbotSettingsInputSchema)) settings: ChatbotSettingsInput,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<ChatbotSettingsView> {
    const saved = await this.chatbotSettings.saveNewVersion({
      ...settings,
      createdByAdminUserId: actingAdminUserId(principal),
    });
    await this.recordAudit(principal, request, 'chatbot_settings.saved', saved.version);
    return presentSettings(saved);
  }

  @Get('versions')
  @ApiOperation({ summary: 'Every saved version, newest first' })
  @ApiJsonResponse(chatbotSettingsSchema.array())
  async listVersions(): Promise<ChatbotSettingsView[]> {
    const versions = await this.chatbotSettingsRepository.listVersions(LISTED_VERSIONS);
    return versions.map(presentSettings);
  }

  @Post('versions/:version/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Roll back (or forward) to a saved version' })
  @ApiJsonResponse(chatbotSettingsSchema)
  async activate(
    @Param('version', new ZodValidationPipe(settingsVersionParameterSchema)) version: number,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<ChatbotSettingsView> {
    const settings = await this.chatbotSettingsRepository.findByVersion(version);
    if (settings === undefined) {
      throw new ApplicationError(404, 'settings_version_not_found', 'No settings version has this number.');
    }
    await this.chatbotSettings.activate(version);
    await this.recordAudit(principal, request, 'chatbot_settings.activated', version);
    return presentSettings({ ...settings, isActive: true });
  }

  private async recordAudit(
    principal: AdminPrincipal,
    request: Request,
    action: string,
    version: number,
  ): Promise<void> {
    const requestId = requestIdOf(request);
    await this.auditEventsRepository.record({
      actor: auditActorOf(principal),
      action,
      targetType: 'chatbot_settings',
      targetId: String(version),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
}

function presentSettings(settings: ChatbotSettingsRecord): ChatbotSettingsView {
  return {
    version: settings.version,
    isActive: settings.isActive,
    botName: settings.botName,
    greetingMessage: settings.greetingMessage,
    suggestedPrompts: settings.suggestedPrompts,
    systemInstruction: settings.systemInstruction,
    fallbackMessage: settings.fallbackMessage,
    answerTemperature: settings.answerTemperature,
    maxAnswerTokens: settings.maxAnswerTokens,
    maxSources: settings.maxSources,
    minSimilarity: settings.minSimilarity,
    showReasoning: settings.showReasoning,
    showSources: settings.showSources,
    reasoningEffort: settings.reasoningEffort,
    memorySummaryThresholdRatio: settings.memorySummaryThresholdRatio,
    memoryRecentTurnCount: settings.memoryRecentTurnCount,
    maxMessageChars: settings.maxMessageChars,
    maxTurnsPerConversation: settings.maxTurnsPerConversation,
    note: settings.note,
    createdByAdminUserId: settings.createdByAdminUserId,
    createdAt: settings.createdAt.toISOString(),
  };
}
