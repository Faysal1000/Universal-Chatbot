import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { UpstreamServiceError } from '../../common/outbound-http/upstream-service-error.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import type { HumanVerificationPort } from '../../ports/human-verification.port.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MILLISECONDS = 5_000;
const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

/**
 * Cloudflare Turnstile. Without configured keys every visitor is admitted: local
 * development and the Hugging Face demo then rely on rate limits and the token budget.
 */
@Injectable()
export class TurnstileAdapter implements HumanVerificationPort {
  private readonly logger = new Logger(TurnstileAdapter.name);
  readonly siteKey: string | null;
  private readonly secretKey: string | undefined;

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.siteKey = configuration.publicAccess.turnstile?.siteKey ?? null;
    this.secretKey = configuration.publicAccess.turnstile?.secretKey.reveal();
  }

  async verify(challengeToken: string, clientAddress: string): Promise<boolean> {
    if (this.secretKey === undefined) return true;
    const form = new URLSearchParams({
      secret: this.secretKey,
      response: challengeToken,
      remoteip: clientAddress,
    });
    const result = siteverifyResponseSchema.safeParse(await this.callSiteverify(form));
    if (!result.success) return false;
    if (!result.data.success) {
      this.logger.debug({ errorCodes: result.data['error-codes'] }, 'Turnstile rejected');
    }
    return result.data.success;
  }

  private async callSiteverify(form: URLSearchParams): Promise<unknown> {
    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MILLISECONDS),
      });
      return await response.json();
    } catch (error: unknown) {
      throw new UpstreamServiceError(
        'turnstile',
        'siteverify',
        `Turnstile is unreachable: ${String(error)}`,
        {
          isRetryable: true,
        },
      );
    }
  }
}
