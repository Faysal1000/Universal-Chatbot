import { Link } from 'react-router';

import { formatBytes, formatInteger } from '@/shared/lib/format';
import { documentPath } from '@/shared/routePaths';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { Tag } from '@/shared/ui/StatusMessages';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { ConversationMessage, MessageCitation } from '../api/conversationTypes';
import { messageAnchorId } from '../messageAnchor';

const MESSAGE_STATUS_LABELS: Record<Exclude<ConversationMessage['status'], 'complete'>, string> = {
  stopped: 'Stopped before the end',
  error: 'Ended with an error',
};

export function MessageBlock({ message }: { message: ConversationMessage }) {
  const isAssistant = message.role === 'assistant';
  return (
    <article
      id={messageAnchorId(message.id)}
      className="grid scroll-mt-20 gap-x-4 gap-y-1 border-t border-border py-2.5 first:border-t-0 target:bg-accent-soft sm:grid-cols-[8.5rem_minmax(0,1fr)]"
      aria-label={isAssistant ? 'Assistant message' : 'Visitor message'}
    >
      <header className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs sm:flex-col">
        <span className="font-semibold text-primary">{isAssistant ? 'Assistant' : 'Visitor'}</span>
        {message.status === 'complete' ? null : (
          <StatePlacard
            state={message.status === 'error' ? 'failed' : 'stopped'}
            label={MESSAGE_STATUS_LABELS[message.status]}
            className="text-xs"
          />
        )}
        {message.feedback ? <FeedbackMark rating={message.feedback} /> : null}
      </header>
      <div className="min-w-0">
        <p className="text-sm whitespace-pre-wrap text-primary">{message.content || '(empty)'}</p>
        {message.attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.attachments.map((attachment) => (
              <Tag key={attachment.id}>
                Image {attachment.mimeType.replace('image/', '').toUpperCase()} {formatInteger(attachment.width)}×
                {formatInteger(attachment.height)}, {formatBytes(attachment.sizeBytes)}
              </Tag>
            ))}
          </div>
        ) : null}
        {message.reasoning ? (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted">Model reasoning</summary>
            <p className="mt-1 whitespace-pre-wrap text-secondary">{message.reasoning}</p>
          </details>
        ) : null}
        {message.citations.length > 0 ? <CitationTable citations={message.citations} /> : null}
      </div>
    </article>
  );
}

function FeedbackMark({ rating }: { rating: 'up' | 'down' }) {
  return (
    <StatePlacard
      state={rating === 'up' ? 'ready' : 'warning'}
      label={rating === 'up' ? 'Rated helpful' : 'Rated not helpful'}
      className="text-xs"
    />
  );
}

function CitationTable({ citations }: { citations: readonly MessageCitation[] }) {
  return (
    <div className="mt-2">
      <Table caption="Citations in this answer">
        <thead>
          <tr>
            <HeaderCell isNumeric>Marker</HeaderCell>
            <HeaderCell>Document</HeaderCell>
            <HeaderCell isNumeric>Page</HeaderCell>
            <HeaderCell>Kind</HeaderCell>
            <HeaderCell>Snippet</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {citations.map((citation) => (
            <tr key={citation.id}>
              <DataCell isNumeric>[{citation.marker}]</DataCell>
              <DataCell className="max-w-56">
                <Link
                  to={documentPath(citation.documentId)}
                  className="block truncate text-primary hover:text-accent hover:underline"
                >
                  {citation.documentTitle}
                </Link>
              </DataCell>
              <DataCell isNumeric>{formatInteger(citation.page)}</DataCell>
              <DataCell>{citation.kind === 'visual' ? 'Figure or table' : 'Text'}</DataCell>
              <DataCell className="max-w-md">
                <span className="line-clamp-2">{citation.snippet}</span>
              </DataCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
