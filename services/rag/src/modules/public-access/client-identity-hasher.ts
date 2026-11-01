import { Inject, Injectable } from '@nestjs/common';

import { hmacSha256Hex } from '../../common/security/secure-tokens.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';

/** Keyed hashes of client IPs and fingerprints: comparable, but not reversible from a dump. */
@Injectable()
export class ClientIdentityHasher {
  private readonly hashSecret: string;

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.hashSecret = configuration.publicAccess.clientHashSecret.reveal();
  }

  hashAddress(clientAddress: string): string {
    return hmacSha256Hex(this.hashSecret, `ip:${clientAddress}`);
  }

  hashFingerprint(fingerprint: string): string {
    return hmacSha256Hex(this.hashSecret, `fingerprint:${fingerprint}`);
  }
}
