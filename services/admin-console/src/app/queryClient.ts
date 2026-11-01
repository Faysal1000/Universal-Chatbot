import { QueryClient } from '@tanstack/react-query';

import { sessionQueryKeys } from '@/features/session/api/sessionQueryKeys';
import { ApiError, setUnauthorizedListener } from '@/shared/api/httpClient';

const MAXIMUM_QUERY_RETRIES = 2;

/** Only network failures are retried: an answer from the console backend (4xx, or 5xx for a service that is down) would repeat. */
function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return failureCount < MAXIMUM_QUERY_RETRIES;
}

export function createAdminQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false, staleTime: 15_000 },
      mutations: { retry: false },
    },
  });
  // Any 401 means the session expired: forget it so the route guard shows the login page.
  setUnauthorizedListener(() => {
    queryClient.setQueryData(sessionQueryKeys.current, null);
  });
  return queryClient;
}
