import type { operations } from '@/contracts/rag';

export type WidgetKey =
  operations['WidgetKeysAdminController_list']['responses'][200]['content']['application/json'][number];
export type WidgetKeyCreateRequest =
  operations['WidgetKeysAdminController_create']['requestBody']['content']['application/json'];
export type WidgetKeyUpdateRequest =
  operations['WidgetKeysAdminController_update']['requestBody']['content']['application/json'];
