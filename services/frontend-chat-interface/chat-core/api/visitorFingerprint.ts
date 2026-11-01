/**
 * A coarse, privacy-light device signal for the backend's rate limiter. It is a *signal*, not an identifier:
 * the backend treats it as spoofable and relies on Turnstile + IP limits for real protection.
 */
export async function computeVisitorFingerprint(): Promise<string> {
  const signals = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(navigator.hardwareConcurrency),
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signals));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
