import { Link } from 'react-router';

import { formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { conversationPath } from '@/shared/routePaths';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import type { ConversationSummary } from '../api/conversationTypes';
import { visitorConversationsSearch } from '../conversationFilters';
import { toPlainPreview } from '../messagePreview';
import { shortUuid } from '../retrievalTraceModel';

export function ConversationsTable({ conversations }: { conversations: readonly ConversationSummary[] }) {
  return (
    <Table caption="Visitor conversations, most recently active first">
      <thead>
        <tr>
          <HeaderCell>Conversation</HeaderCell>
          <HeaderCell>Last message</HeaderCell>
          <HeaderCell isNumeric>Turns</HeaderCell>
          <HeaderCell>Visitor session</HeaderCell>
          <HeaderCell>Last active</HeaderCell>
          <HeaderCell>Started</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {conversations.map((conversation) => (
          <tr key={conversation.id} className="hover:bg-surface-hover">
            <DataCell className="max-w-64">
              <Link
                to={conversationPath(conversation.id)}
                className="block truncate font-medium text-primary hover:text-accent hover:underline"
              >
                {conversation.title || 'Untitled conversation'}
              </Link>
            </DataCell>
            <DataCell className="max-w-96">
              <span className="line-clamp-2 text-secondary">
                {conversation.lastMessagePreview === null
                  ? 'No messages'
                  : toPlainPreview(conversation.lastMessagePreview)}
              </span>
            </DataCell>
            <DataCell isNumeric>{formatInteger(conversation.turnCount)}</DataCell>
            <DataCell>
              <Link
                to={visitorConversationsSearch(conversation.visitorSessionId)}
                className="font-mono text-xs text-secondary hover:text-accent hover:underline"
                title={`Show every conversation of visitor session ${conversation.visitorSessionId}`}
              >
                {shortUuid(conversation.visitorSessionId)}
              </Link>
            </DataCell>
            <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(conversation.updatedAt)}</DataCell>
            <DataCell className="tabular whitespace-nowrap">{formatShortDateTime(conversation.createdAt)}</DataCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
