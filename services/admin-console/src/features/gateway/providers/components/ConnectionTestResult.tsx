import { formatDurationMilliseconds, formatInteger } from '@/shared/lib/format';
import { StatusBadge } from '@/shared/ui/StatusMessages';

import type { ConnectionTestResponse } from '../api/providerTypes';

/** Outcome of a one-off model test: status, latency, token counts and a reply preview. */
export function ConnectionTestResult({ result }: { result: ConnectionTestResponse }) {
  const hasTokenCounts = result.input_tokens !== null || result.output_tokens !== null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded border border-border bg-surface-raised px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusBadge tone={result.success ? 'good' : 'critical'} label={result.success ? 'Success' : 'Failed'} />
        <span className="text-secondary">{formatDurationMilliseconds(result.latency_ms)}</span>
        {result.http_status !== null ? <span className="text-secondary">HTTP {result.http_status}</span> : null}
        {hasTokenCounts ? (
          <span className="text-secondary">
            {formatInteger(result.input_tokens)} in · {formatInteger(result.output_tokens)} out tokens
          </span>
        ) : null}
      </div>
      <p className="text-secondary">{result.message}</p>
      {result.response_preview ? (
        <pre className="max-h-32 overflow-auto rounded-md bg-surface-input p-2 font-mono text-xs whitespace-pre-wrap text-secondary">
          {result.response_preview}
        </pre>
      ) : null}
    </div>
  );
}
