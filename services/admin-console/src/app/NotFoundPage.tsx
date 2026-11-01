import { Link } from 'react-router';

import { ROUTE_PATHS } from '@/shared/routePaths';
import { EmptyState } from '@/shared/ui/StatusMessages';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link to={ROUTE_PATHS.overview} className="text-sm text-accent hover:underline">
          Go to the overview
        </Link>
      }
    />
  );
}
