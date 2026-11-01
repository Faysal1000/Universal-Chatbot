import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useCurrentSession } from '@/features/session/api/sessionQueries';
import { describeError } from '@/shared/api/httpClient';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

/** Renders its children only for a signed-in admin; otherwise redirects to the login page. */
export function RequireSession({ children }: { children: ReactNode }) {
  const sessionQuery = useCurrentSession();
  const location = useLocation();

  if (sessionQuery.isPending) return <LoadingState label="Checking session…" />;
  if (sessionQuery.isError) {
    return (
      <div className="mx-auto mt-24 max-w-md px-4">
        <ErrorBanner
          title="Cannot load the console"
          message={describeError(sessionQuery.error)}
          onRetry={() => void sessionQuery.refetch()}
        />
      </div>
    );
  }
  if (sessionQuery.data === null) {
    const returnPath = `${location.pathname}${location.search}`;
    return <Navigate to={ROUTE_PATHS.login} replace state={{ returnPath }} />;
  }
  return children;
}
