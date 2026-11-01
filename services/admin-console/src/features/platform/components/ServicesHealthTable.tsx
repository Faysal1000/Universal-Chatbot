import { Link } from 'react-router';

import { formatDurationMilliseconds } from '@/shared/lib/format';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { ServiceHealth } from '../api/platformTypes';
import { dependencyPlacardState, HEALTH_PLACARD } from '../healthState';

const PAGE_BY_SERVICE: Readonly<Record<string, string>> = {
  'llm-gateway': ROUTE_PATHS.gatewayAnalytics,
  'rag-api': ROUTE_PATHS.ragOverview,
  'rag-worker': ROUTE_PATHS.ragQueues,
  'document-parser': ROUTE_PATHS.ragDocuments,
  'local-llm': ROUTE_PATHS.localModels,
};

function DependencyList({ service }: { service: ServiceHealth }) {
  if (service.dependencies.length === 0) {
    // A ready service's detail only repeats its state.
    const detail = service.status === 'ready' ? null : service.detail;
    return <span className="text-muted">{detail ?? '—'}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {service.dependencies.map((dependency) => (
        <li key={dependency.name}>
          <StatePlacard state={dependencyPlacardState(dependency.status)} label={dependency.name} className="text-xs" />
        </li>
      ))}
    </ul>
  );
}

/** One ruled line per service: readiness, probe latency, and its dependencies when it reports them. */
export function ServicesHealthTable({ services }: { services: readonly ServiceHealth[] }) {
  return (
    <Table caption="Service health" isStackedOnMobile>
      <thead>
        <tr>
          <HeaderCell>Service</HeaderCell>
          <HeaderCell>State</HeaderCell>
          <HeaderCell isNumeric>Probe</HeaderCell>
          <HeaderCell>Dependencies</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {services.map((service) => {
          const placard = HEALTH_PLACARD[service.status];
          const pagePath = PAGE_BY_SERVICE[service.id];
          return (
            <tr key={service.id}>
              <DataCell className="max-sm:basis-full">
                {pagePath ? (
                  <Link to={pagePath} className="font-medium text-primary hover:underline">
                    {service.name}
                  </Link>
                ) : (
                  <span className="font-medium text-primary">{service.name}</span>
                )}
                <p className="text-xs text-muted">{service.role}</p>
              </DataCell>
              <DataCell>
                <StatePlacard state={placard.state} label={placard.label} />
              </DataCell>
              <DataCell isNumeric>{formatDurationMilliseconds(service.latencyMilliseconds)}</DataCell>
              <DataCell className="max-sm:basis-full">
                <DependencyList service={service} />
              </DataCell>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
