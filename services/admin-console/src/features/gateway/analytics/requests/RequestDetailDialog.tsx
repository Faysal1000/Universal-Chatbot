import type { ReactNode } from 'react';

import { formatDateTime, formatDurationMilliseconds, formatInteger, formatTokensPerSecond } from '@/shared/lib/format';
import { Dialog } from '@/shared/ui/Dialog';
import { StatusBadge } from '@/shared/ui/StatusMessages';

import type { RecentRequestEntry } from '../api/analyticsTypes';

/** Every recorded field of one request. */
export function RequestDetailDialog({ request, onClose }: { request: RecentRequestEntry | null; onClose: () => void }) {
  return (
    <Dialog isOpen={request !== null} onClose={onClose} width="large" title="Request details">
      {request ? <RequestDetailList request={request} /> : null}
    </Dialog>
  );
}

function RequestDetailList({ request }: { request: RecentRequestEntry }) {
  const isSuccess = request.error_class === null && request.http_status < 400;
  const detailRows: [string, ReactNode][] = [
    ['Request ID', <span className="font-mono break-all">{request.request_id}</span>],
    ['Started at', formatDateTime(request.started_at)],
    ['Task', <span className="font-mono">{request.task_name}</span>],
    ['Provider', <span className="font-mono">{request.provider_id}</span>],
    ['Model', <span className="font-mono">{request.model_id}</span>],
    ['Upstream protocol', request.upstream_protocol],
    ['Streaming', request.is_stream ? 'Yes' : 'No'],
    ['Fallback', request.is_fallback ? 'Yes, a later chain step' : 'No'],
    ['Chain step', describeChainStep(request)],
    ['Fallback reason', request.fallback_reason ? <span className="font-mono">{request.fallback_reason}</span> : '—'],
    ['HTTP status', <StatusBadge tone={isSuccess ? 'good' : 'critical'} label={String(request.http_status)} />],
    ['Error class', request.error_class ?? '—'],
    [
      'Error message',
      request.error_message ? (
        <pre className="max-h-48 overflow-auto rounded-md bg-surface-input p-2 font-mono text-xs whitespace-pre-wrap">
          {request.error_message}
        </pre>
      ) : (
        '—'
      ),
    ],
    ['Attempts', formatInteger(request.attempt_count)],
    ['Input tokens', formatInteger(request.input_tokens)],
    ['Cached input tokens', formatInteger(request.cached_input_tokens)],
    ['Output tokens', formatInteger(request.output_tokens)],
    ['Reasoning tokens', formatInteger(request.reasoning_tokens)],
    ['Time to first token', formatDurationMilliseconds(request.time_to_first_token_ms)],
    ['Total duration', formatDurationMilliseconds(request.total_duration_ms)],
    ['Output tokens per second', formatTokensPerSecond(request.output_tokens_per_second)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
      {detailRows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function describeChainStep(request: RecentRequestEntry): string {
  if (request.chain_step === null) return '—';
  const triedSuffix =
    request.chain_steps_tried === null ? '' : ` (${formatInteger(request.chain_steps_tried)} reached)`;
  return `Step ${formatInteger(request.chain_step)}${triedSuffix}`;
}
