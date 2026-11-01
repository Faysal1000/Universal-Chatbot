import { describeError } from '@/shared/api/httpClient';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useQueues } from './api/operationsQueries';
import { DeadLettersCard } from './components/DeadLettersCard';
import { QueuesTable } from './components/QueuesTable';

export function QueuesPage() {
  const queuesQuery = useQueues();
  return (
    <>
      <PageHeader title="Queues" />
      <div className="flex flex-col gap-6">
        {queuesQuery.isPending ? (
          <LoadingState label="Loading queues…" />
        ) : queuesQuery.isError ? (
          <ErrorBanner
            title="Could not load queues"
            message={describeError(queuesQuery.error)}
            onRetry={() => void queuesQuery.refetch()}
          />
        ) : queuesQuery.data.length === 0 ? (
          <Card>
            <EmptyState title="No queues reported" description="Listed once Redis is reachable." />
          </Card>
        ) : (
          <Card title="Job queues" bodyClassName="p-0">
            <QueuesTable queues={queuesQuery.data} />
          </Card>
        )}
        <DeadLettersCard />
      </div>
    </>
  );
}
