import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getRagOverview } from './overviewApi';
import { overviewQueryKeys } from './overviewQueryKeys';
import type { OverviewWindowDays } from './overviewTypes';

const OVERVIEW_REFRESH_MILLISECONDS = 60_000;

export function useRagOverview(days: OverviewWindowDays) {
  return useQuery({
    queryKey: overviewQueryKeys.window(days),
    queryFn: () => getRagOverview(days),
    placeholderData: keepPreviousData,
    refetchInterval: OVERVIEW_REFRESH_MILLISECONDS,
  });
}
