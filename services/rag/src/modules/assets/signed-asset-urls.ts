import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ApplicationError } from '../../common/errors/application-error.js';
import { areEqualInConstantTime, hmacSha256Hex } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { parseJsonOrUndefined } from '../../common/text/parse-json-or-undefined.js';

export const ASSET_ROUTE_PREFIX = '/v1/public/assets';

const assetClaimsSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  expiresAtSeconds: z.number().int(),
});
export type AssetClaims = z.infer<typeof assetClaimsSchema>;

/**
 * Short-lived, signed URLs for stored images (attachments, page renders, crops). The api
 * streams the object itself, so object storage never needs to be reachable from browsers.
 */
@Injectable()
export class SignedAssetUrls {
  private readonly signingKey: string;

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.signingKey = hmacSha256Hex(
      configuration.publicAccess.clientHashSecret.reveal(),
      'asset-url-signing',
    );
  }

  /** A server-relative URL valid for `lifetimeSeconds`, and when it expires. */
  sign(key: string, contentType: string, lifetimeSeconds: number): { url: string; expiresAt: Date } {
    const expiresAtSeconds = Math.floor(Date.now() / 1_000) + lifetimeSeconds;
    const claims: AssetClaims = { key, contentType, expiresAtSeconds };
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return {
      url: `${ASSET_ROUTE_PREFIX}/${encodedClaims}.${this.signatureOf(encodedClaims)}`,
      expiresAt: new Date(expiresAtSeconds * 1_000),
    };
  }

  verify(token: string): AssetClaims {
    const [encodedClaims = '', signature = ''] = token.split('.');
    if (!areEqualInConstantTime(signature, this.signatureOf(encodedClaims))) throw invalidAssetUrlError();
    const claims = assetClaimsSchema.safeParse(
      parseJsonOrUndefined(Buffer.from(encodedClaims, 'base64url').toString('utf8')),
    );
    if (!claims.success || claims.data.expiresAtSeconds * 1_000 < Date.now()) throw invalidAssetUrlError();
    return claims.data;
  }

  private signatureOf(encodedClaims: string): string {
    return createHmac('sha256', this.signingKey).update(encodedClaims).digest('base64url');
  }
}

function invalidAssetUrlError(): ApplicationError {
  return new ApplicationError(404, 'not_found', 'This link is invalid or has expired.');
}
