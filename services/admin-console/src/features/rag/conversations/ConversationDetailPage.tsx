import { ArrowLeft, Ban } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { describeError } from '@/shared/api/httpClient';
import { formatDateTime, formatInteger } from '@/shared/lib/format';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { CreateClientBlockDialog } from '../clientBlocks/components/CreateClientBlockDialog';
import { useConversation } from './api/conversationQueries';
import type { ConversationDetail } from './api/conversationTypes';
import { TurnSection } from './components/TurnSection';
import { visitorConversationsSearch } from './conversationFilters';
import { shortUuid } from './retrievalTraceModel';

export function ConversationDetailPage() {
  const { conversationId = '' } = useParams();
  const conversationQuery = useConversation(conversationId);
  useScrollToHashTarget(conversationQuery.isSuccess);

  return (
    <>
      <Link
        to={ROUTE_PATHS.ragConversations}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All conversations
      </Link>
      {conversationQuery.isPending ? (
        <LoadingState label="Loading the conversation…" />
      ) : conversationQuery.isError ? (
        <ErrorBanner
          title="Could not load this conversation"
          message={describeError(conversationQuery.error)}
          onRetry={() => void conversationQuery.refetch()}
        />
      ) : (
        <ConversationTranscript conversation={conversationQuery.data} />
      )}
    </>
  );
}

/** Brings `#message-…` links from the feedback list into view once the transcript has rendered. */
function useScrollToHashTarget(isContentReady: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!isContentReady || hash === '') return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' });
  }, [isContentReady, hash]);
}

function ConversationTranscript({ conversation }: { conversation: ConversationDetail }) {
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={conversation.title || 'Untitled conversation'}
        actions={
          <>
            <Link
              to={`${ROUTE_PATHS.ragConversations}${visitorConversationsSearch(conversation.visitorSessionId)}`}
              className="text-sm font-medium text-secondary hover:text-primary hover:underline"
            >
              This visitor's conversations
            </Link>
            <Button
              variant="danger"
              leadingIcon={<Ban aria-hidden="true" className="size-4" />}
              onClick={() => setIsBlockDialogOpen(true)}
            >
              Block this visitor
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <ManifestStrip fields={buildConversationManifestFields(conversation)} />
        {conversation.summary ? (
          <Card title="Rolling summary" description={`Updated ${formatDateTime(conversation.summary.updatedAt)}`}>
            <p className="text-sm whitespace-pre-wrap text-secondary">{conversation.summary.text}</p>
          </Card>
        ) : null}
        {conversation.turns.length === 0 ? (
          <Card>
            <EmptyState title="No turns yet" />
          </Card>
        ) : (
          conversation.turns.map((turn, turnIndex) => (
            <TurnSection key={turn.id} turn={turn} turnNumber={turnIndex + 1} />
          ))
        )}
      </div>
      <CreateClientBlockDialog
        isOpen={isBlockDialogOpen}
        onClose={() => setIsBlockDialogOpen(false)}
        initialVisitorSessionId={conversation.visitorSessionId}
      />
    </>
  );
}

function buildConversationManifestFields(conversation: ConversationDetail) {
  const totalTokens = conversation.turns.reduce(
    (sum, turn) => sum + turn.usage.inputTokens + turn.usage.outputTokens + turn.usage.reasoningTokens,
    0,
  );
  return [
    { label: 'Turns', value: formatInteger(conversation.turnCount) },
    { label: 'Tokens', value: formatInteger(totalTokens), note: 'input, output and reasoning' },
    { label: 'Started', value: formatDateTime(conversation.createdAt) },
    { label: 'Last active', value: formatDateTime(conversation.updatedAt) },
    {
      label: 'Visitor session',
      value: <span className="font-mono text-base">{shortUuid(conversation.visitorSessionId)}</span>,
      note: conversation.visitorSessionId,
    },
  ];
}
