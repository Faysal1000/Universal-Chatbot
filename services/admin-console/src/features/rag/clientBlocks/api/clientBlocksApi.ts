import { requestRagApi } from '@/shared/api/httpClient';

import type { ClientBlock, ClientBlockCreateRequest } from './clientBlockTypes';

export function listClientBlocks(): Promise<ClientBlock[]> {
  return requestRagApi<ClientBlock[]>('/client-blocks');
}

export function createClientBlock(request: ClientBlockCreateRequest): Promise<ClientBlock> {
  return requestRagApi<ClientBlock>('/client-blocks', { method: 'POST', body: request });
}

export function deleteClientBlock(blockId: string): Promise<void> {
  return requestRagApi<undefined>(`/client-blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' });
}
