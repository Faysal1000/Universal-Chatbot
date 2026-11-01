import { requestRagApi } from '@/shared/api/httpClient';

import type { OverviewWindowDays, RagOverview } from './overviewTypes';

export function getRagOverview(days: OverviewWindowDays): Promise<RagOverview> {
  return requestRagApi<RagOverview>('/analytics/overview', { queryParameters: { days } });
}
