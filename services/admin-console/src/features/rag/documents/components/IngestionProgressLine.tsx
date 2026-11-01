import { StatePlacard } from '@/shared/ui/StatePlacard';

import type { IngestionProgressView } from '../ingestionProgressModel';
import { ProgressBar } from './ProgressBar';

/** Stage, percentage, page count and bar for one document's ingestion. */
export function IngestionProgressLine({ progress, subject }: { progress: IngestionProgressView; subject: string }) {
  const isFailed = progress.failure !== null || progress.placardState === 'failed';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <StatePlacard state={progress.placardState} label={progress.label} />
        <span className="tabular text-muted">
          {progress.pagesLabel ? `${progress.pagesLabel} · ` : ''}
          {progress.percent}%
        </span>
      </div>
      <ProgressBar percent={progress.percent} label={`Ingestion of ${subject}`} isFailed={isFailed} />
      {progress.failure ? (
        <p className="text-xs text-critical-text">
          <span className="font-mono">{progress.failure.code}</span>: {progress.failure.message}
        </p>
      ) : null}
    </div>
  );
}
