import { adminRequest } from './stack';

export interface WidgetKey {
  id: string;
  name: string;
  publishableKey: string;
  allowedOrigins: string[];
  status: 'active' | 'revoked';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function listWidgetKeys(): Promise<WidgetKey[]> {
  return adminRequest<WidgetKey[]>('/widget-keys');
}

export function createWidgetKey(name: string, allowedOrigins: string[]): Promise<WidgetKey> {
  return adminRequest<WidgetKey>('/widget-keys', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, allowedOrigins, turnsPerMinute: 120 }),
  });
}

export function revokeWidgetKey(widgetKeyId: string): Promise<WidgetKey> {
  return adminRequest<WidgetKey>(`/widget-keys/${widgetKeyId}/revoke`, { method: 'POST' });
}

/** An active key with exactly these origins, reused across runs so repeated runs do not pile keys up. */
export async function ensureWidgetKey(name: string, allowedOrigins: string[]): Promise<WidgetKey> {
  const existing = (await listWidgetKeys()).find(
    (key) =>
      key.name === name && key.status === 'active' && key.allowedOrigins.join() === allowedOrigins.join(),
  );
  return existing ?? createWidgetKey(name, allowedOrigins);
}
