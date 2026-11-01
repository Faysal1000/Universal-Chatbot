/** Proves a visitor is a human (Cloudflare Turnstile) before a session is issued. */
export interface HumanVerificationPort {
  /** Whether a challenge is required at all; the public config exposes the site key. */
  readonly siteKey: string | null;
  /** True when the challenge token is valid for this client. */
  verify(challengeToken: string, clientAddress: string): Promise<boolean>;
}

export const HUMAN_VERIFICATION_PORT = Symbol('HUMAN_VERIFICATION_PORT');
