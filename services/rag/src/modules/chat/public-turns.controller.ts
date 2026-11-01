import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { requestIdOf } from '../../common/http/request-identity.js';
import { ServerSentEventStream } from '../../common/http/server-sent-events.js';
import { ApiJsonBody } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { VisitorAuthenticationGuard } from '../public-access/visitor-authentication.guard.js';
import { CurrentVisitor, type VisitorPrincipal } from '../public-access/visitor-principal.js';
import { uuidParameterSchema } from './conversations/public-chat.schemas.js';
import {
  type SubmitTurnRequest,
  submitTurnRequestSchema,
  SubmitTurnService,
} from './turns/submit-turn.service.js';
import { TurnStreamService } from './turns/turn-stream.service.js';

const lastEventIdSchema = z.coerce.number().int().min(0).default(0);

const TURN_EVENTS_DESCRIPTION =
  'Server-sent events, each with a monotonic `id`: `message.started`, `status` {stage: queued|rewriting|retrieving|generating}, ' +
  '`reasoning.delta` (only when `/config.features.reasoning`), `answer.delta` (Markdown with inline `[n]` markers), ' +
  '`answer.citations`, `conversation.updated`, `turn.superseded`, then `message.completed` ' +
  '{finishReason: stop|length|no_evidence|cancelled} or `error`. A `: ping` comment is sent every 15 s.';

@ApiTags('Public: turns')
@ApiBearerAuth('visitor-session')
@Controller('v1/public/conversations/:conversationId/turns')
@UseGuards(VisitorAuthenticationGuard)
export class PublicTurnsController {
  constructor(
    private readonly submitTurn: SubmitTurnService,
    private readonly turnStream: TurnStreamService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a batch of visitor messages and stream the single reply',
    description:
      `${TURN_EVENTS_DESCRIPTION} Resending the same turn replays its stream; a different body with the same ` +
      'key is 409 `idempotency_conflict`. A turn still answering is 409 `turn_in_progress`; one that has not ' +
      'started answering is superseded (its stream gets `turn.superseded`) and answered together with this one.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Equal to `turnId`' })
  @ApiJsonBody(submitTurnRequestSchema)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: "The turn's server-sent events, ending with `message.completed` or `error`" })
  async submit(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(submitTurnRequestSchema)) body: SubmitTurnRequest,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const turnId = await this.submitTurn.submit({
      conversationId,
      visitor,
      idempotencyKey,
      request: body,
      requestId: requestIdOf(request),
    });
    const turn = await this.turnStream.findOwnedTurn(visitor, conversationId, turnId);
    await this.turnStream.stream(turn, 0, () => new ServerSentEventStream(response));
  }

  @Get(':turnId/events')
  @ApiOperation({
    summary: 'Resume or replay the event stream of a turn',
    description: `Sends events after \`Last-Event-ID\` (0 replays everything). Events are kept 10 minutes after the turn; 404 afterwards for unfinished turns.`,
  })
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  @ApiProduces('text/event-stream')
  async resume(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Param('turnId', new ZodValidationPipe(uuidParameterSchema)) turnId: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const afterSequence = new ZodValidationPipe(lastEventIdSchema).transform(lastEventIdHeader);
    const turn = await this.turnStream.findOwnedTurn(visitor, conversationId, turnId);
    await this.turnStream.stream(turn, afterSequence, () => new ServerSentEventStream(response));
  }

  @Post(':turnId/cancel')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Stop generating',
    description: 'The partial answer is kept as `stopped`; the stream ends with `finishReason: cancelled`.',
  })
  @ApiAcceptedResponse()
  async cancel(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Param('turnId', new ZodValidationPipe(uuidParameterSchema)) turnId: string,
  ): Promise<void> {
    const turn = await this.turnStream.findOwnedTurn(visitor, conversationId, turnId);
    await this.turnStream.cancel(turn);
  }
}
