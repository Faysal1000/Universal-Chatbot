import { Link } from 'react-router';

import { usePlatformHealth } from '@/features/platform/api/platformQueries';
import { HEALTH_PLACARD } from '@/features/platform/healthState';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { PlacardShape } from '@/shared/ui/StatePlacard';

/** Every service's readiness, always visible in the top bar; links to the overview. */
export function HealthStrip() {
  const healthQuery = usePlatformHealth();
  const services = healthQuery.data ?? [];
  const unhealthyCount = services.filter((service) => service.status !== 'ready').length;
  const summary = healthQuery.isPending
    ? 'Checking services…'
    : healthQuery.isError
      ? 'Health unknown'
      : unhealthyCount === 0
        ? 'All services ready'
        : `${unhealthyCount} of ${services.length} need attention`;

  return (
    <Link
      to={ROUTE_PATHS.overview}
      aria-label={`Service health: ${summary}`}
      className="flex min-w-0 flex-1 items-center gap-3 rounded px-1 py-1 hover:bg-surface-hover"
    >
      <ul className="hidden items-center gap-3 md:flex" aria-hidden="true">
        {services.map((service) => (
          <li key={service.id} className="flex items-center gap-1.5 text-xs text-secondary" title={service.name}>
            <PlacardShape state={HEALTH_PLACARD[service.status].state} className="size-2.5" />
            <span className="whitespace-nowrap">{service.name}</span>
          </li>
        ))}
      </ul>
      <span className="truncate text-xs font-medium text-primary md:ml-auto">{summary}</span>
    </Link>
  );
}
