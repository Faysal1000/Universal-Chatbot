import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { resolveClientAddress } from '../../common/http/client-address.js';
import { ApiJsonBody, ApiJsonResponse } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { HUMAN_VERIFICATION_PORT, type HumanVerificationPort } from '../../ports/human-verification.port.js';
import { PUBLIC_CHAT_LIMITS } from '../chat/public-chat-limits.js';
import { WidgetAccessPolicy } from '../widget-keys/widget-access.policy.js';
import { ChatbotSettingsService } from '../chatbot-settings/chatbot-settings.service.js';
import { VisitorSessionsService } from './visitor-sessions.service.js';

const publicChatConfigSchema = z.object({
  botName: z.string(),
  greeting: z.string(),
  suggestedPrompts: z.array(z.string()),
  turnstileSiteKey: z.string().nullable(),
  limits: z.object({
    maxImageBytes: z.number().int(),
    allowedImageTypes: z.array(z.string()),
    maxImagesPerTurn: z.number().int(),
    maxMessagesPerTurn: z.number().int(),
    maxMessageChars: z.number().int(),
  }),
  features: z.object({ reasoning: z.boolean(), feedback: z.boolean() }),
  showSources: z
    .boolean()
    .describe('When false, answers carry no citations, `[n]` markers or source previews'),
});
type PublicChatConfig = z.infer<typeof publicChatConfigSchema>;

const createSessionRequestSchema = z.object({
  turnstileToken: z.string().min(1).max(4_096).nullable(),
  fingerprint: z.string().min(1).max(512),
});

const visitorSessionSchema = z.object({
  sessionId: z.uuid(),
  sessionToken: z.string(),
  expiresAt: z.iso.datetime(),
});
type VisitorSessionResponse = z.infer<typeof visitorSessionSchema>;

@ApiTags('Public: configuration and sessions')
@Controller('v1/public')
export class PublicConfigController {
  constructor(
    private readonly chatbotSettings: ChatbotSettingsService,
    private readonly visitorSessions: VisitorSessionsService,
    private readonly widgetAccess: WidgetAccessPolicy,
    @Inject(HUMAN_VERIFICATION_PORT) private readonly humanVerification: HumanVerificationPort,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Bot name, greeting, limits and features for the chat widget',
    description:
      'The website widget sends its publishable key as `X-Widget-Key`; the page origin must be one the key ' +
      'allows (403 `widget_key_invalid`, `widget_origin_not_allowed` or `widget_key_required` otherwise).',
  })
  @ApiJsonResponse(publicChatConfigSchema)
  async describeConfig(@Req() request: Request): Promise<PublicChatConfig> {
    await this.widgetAccess.authorizeRequest(request.headers);
    const settings = await this.chatbotSettings.getActive();
    return {
      botName: settings.botName,
      greeting: settings.greetingMessage,
      suggestedPrompts: settings.suggestedPrompts,
      turnstileSiteKey: this.humanVerification.siteKey,
      limits: {
        maxImageBytes: this.configuration.chat.maxAttachmentBytes,
        allowedImageTypes: [...PUBLIC_CHAT_LIMITS.allowedImageTypes],
        maxImagesPerTurn: PUBLIC_CHAT_LIMITS.maxImagesPerTurn,
        maxMessagesPerTurn: PUBLIC_CHAT_LIMITS.maxMessagesPerTurn,
        maxMessageChars: settings.maxMessageChars,
      },
      features: { reasoning: settings.showReasoning, feedback: true },
      showSources: settings.showSources,
    };
  }

  @Post('sessions')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start an anonymous visitor session',
    description:
      'Send the Turnstile token when `/config.turnstileSiteKey` is set. Use the returned token as ' +
      '`Authorization: Bearer <sessionToken>`; a 401 `session_expired` means start a new session.',
  })
  @ApiJsonBody(createSessionRequestSchema)
  @ApiJsonResponse(visitorSessionSchema, { status: 201 })
  async createSession(
    @Body(new ZodValidationPipe(createSessionRequestSchema)) body: z.infer<typeof createSessionRequestSchema>,
    @Req() request: Request,
  ): Promise<VisitorSessionResponse> {
    const widgetKey = await this.widgetAccess.authorizeRequest(request.headers);
    const session = await this.visitorSessions.issue({
      turnstileToken: body.turnstileToken,
      fingerprint: body.fingerprint,
      clientAddress: resolveClientAddress(request, this.configuration.publicAccess.trustedProxyHops),
      userAgent: request.headers['user-agent'] ?? null,
      widgetKeyId: widgetKey?.widgetKeyId ?? null,
    });
    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
