import { useQuery } from '@tanstack/react-query';

import { requestConsoleApi } from '@/shared/api/httpClient';

import type { ServiceHealth } from './platformTypes';

const LIVE_REFRESH_MILLISECONDS = 15_000;

const platformQueryKeys = {
  health: ['platform', 'health'] as const,
};

export function usePlatformHealth() {
  return useQuery({
    queryKey: platformQueryKeys.health,
    queryFn: async () => (await requestConsoleApi<{ services: ServiceHealth[] }>('/platform/health')).services,
    refetchInterval: LIVE_REFRESH_MILLISECONDS,
  });
}
