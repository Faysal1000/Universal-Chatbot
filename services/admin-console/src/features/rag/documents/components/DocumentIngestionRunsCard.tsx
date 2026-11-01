import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';

import { useDocumentIngestionRuns } from '../api/documentQueries';
import { RUNS_SHOWN_IN_DOCUMENT_DETAIL } from '../api/documentTypes';
import type { DocumentDetail } from '../api/documentTypes';
import { IngestionRunsTable } from './IngestionRunsTable';

/** The latest runs from the document detail, and on request every run of the document. */
export function DocumentIngestionRunsCard({ document }: { document: DocumentDetail }) {
  const [isShowingAllRuns, setIsShowingAllRuns] = useState(false);
  const allRunsQuery = useDocumentIngestionRuns(document.id, isShowingAllRuns);
  const mayHaveOlderRuns = document.runs.length >= RUNS_SHOWN_IN_DOCUMENT_DETAIL;

  return (
    <Card
      title="Ingestion runs"
      actions={
        mayHaveOlderRuns ? (
          <Button
            size="small"
            aria-pressed={isShowingAllRuns}
            onClick={() => setIsShowingAllRuns((isShowing) => !isShowing)}
          >
            {isShowingAllRuns ? 'Show the latest only' : 'Show all runs'}
          </Button>
        ) : null
      }
      bodyClassName="p-0"
    >
      {!isShowingAllRuns ? (
        <IngestionRunsTable runs={document.runs} />
      ) : allRunsQuery.isPending ? (
        <LoadingState label="Loading every run…" />
      ) : allRunsQuery.isError ? (
        <div className="p-4">
          <ErrorBanner
            title="Could not load every run"
            message={describeError(allRunsQuery.error)}
            onRetry={() => void allRunsQuery.refetch()}
          />
        </div>
      ) : (
        <IngestionRunsTable runs={allRunsQuery.data} />
      )}
    </Card>
  );
}
