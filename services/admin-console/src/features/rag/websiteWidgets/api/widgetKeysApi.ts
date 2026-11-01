import { requestRagApi } from '@/shared/api/httpClient';

import type { WidgetKey, WidgetKeyCreateRequest, WidgetKeyUpdateRequest } from './widgetKeyTypes';

const keyPath = (widgetKeyId: string) => `/widget-keys/${encodeURIComponent(widgetKeyId)}`;

export function listWidgetKeys(): Promise<WidgetKey[]> {
  return requestRagApi<WidgetKey[]>('/widget-keys');
}

export function createWidgetKey(request: WidgetKeyCreateRequest): Promise<WidgetKey> {
  return requestRagApi<WidgetKey>('/widget-keys', { method: 'POST', body: request });
}

export function updateWidgetKey(widgetKeyId: string, request: WidgetKeyUpdateRequest): Promise<WidgetKey> {
  return requestRagApi<WidgetKey>(keyPath(widgetKeyId), { method: 'PATCH', body: request });
}

export function revokeWidgetKey(widgetKeyId: string): Promise<WidgetKey> {
  return requestRagApi<WidgetKey>(`${keyPath(widgetKeyId)}/revoke`, { method: 'POST' });
}
