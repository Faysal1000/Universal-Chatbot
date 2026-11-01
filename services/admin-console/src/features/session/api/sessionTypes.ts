/** The BFF's session API (`/api/session`). */
export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionResponse {
  username: string;
  /** Sent back as `X-CSRF-Token` on every state-changing request. */
  csrfToken: string;
  expiresAt: string;
}
