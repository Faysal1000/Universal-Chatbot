import type { operations } from '@/contracts/rag';

export type ClientBlock =
  operations['ClientBlocksAdminController_list']['responses'][200]['content']['application/json'][number];
/** Exactly one of `visitorSessionId` and `ipAddress`. */
export type ClientBlockCreateRequest =
  operations['ClientBlocksAdminController_create']['requestBody']['content']['application/json'];
