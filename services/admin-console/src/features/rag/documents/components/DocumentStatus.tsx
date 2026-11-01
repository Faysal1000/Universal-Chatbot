import { StatePlacard } from '@/shared/ui/StatePlacard';

import type { DocumentSummary } from '../api/documentTypes';
import { documentStatusPlacard } from '../documentStatusModel';

/** The document's status placard, with rag's failure code and message when it failed. */
export function DocumentStatus({ document }: { document: Pick<DocumentSummary, 'status' | 'failure'> }) {
  const placard = documentStatusPlacard(document.status);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <StatePlacard state={placard.state} label={placard.label} />
      {document.status === 'failed' && document.failure ? (
        <p className="max-w-72 text-xs text-critical-text" title={document.failure.message}>
          <span className="font-mono">{document.failure.code}</span>: {document.failure.message}
        </p>
      ) : null}
    </div>
  );
}
