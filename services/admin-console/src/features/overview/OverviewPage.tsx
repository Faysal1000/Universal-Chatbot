import { describeError } from '@/shared/api/httpClient';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

import { usePlatformHealth } from '../platform/api/platformQueries';
import type { ServiceHealth } from '../platform/api/platformTypes';
import { ServicesHealthTable } from '../platform/components/ServicesHealthTable';

function platformFacts(services: readonly ServiceHealth[]) {
  const readyCount = services.filter((service) => service.status === 'ready').length;
  return [
    {
      label: 'Services ready',
      value: services.length === 0 ? '—' : `${readyCount} of ${services.length}`,
    },
  ];
}

export default function OverviewPage() {
  const healthQuery = usePlatformHealth();
  const services = healthQuery.data ?? [];

  return (
    <>
      <PageHeader title="Platform overview" />
      <ManifestStrip fields={platformFacts(services)} className="mb-5" />
      <Card title="Services" bodyClassName="p-0">
        {healthQuery.isPending ? <LoadingState label="Probing services…" /> : null}
        {healthQuery.isError ? (
          <div className="p-4">
            <ErrorBanner message={describeError(healthQuery.error)} onRetry={() => void healthQuery.refetch()} />
          </div>
        ) : null}
        {healthQuery.data ? <ServicesHealthTable services={healthQuery.data} /> : null}
      </Card>
    </>
  );
}
