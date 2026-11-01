import type { operations } from '@/contracts/rag';

export type IndexVersion =
  operations['IndexVersionsAdminController_list']['responses'][200]['content']['application/json'][number];
export type IndexVersionStatus = IndexVersion['status'];
