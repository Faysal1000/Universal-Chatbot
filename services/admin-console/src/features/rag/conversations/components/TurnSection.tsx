import { joinClassNames } from '@/shared/lib/classNames';
import { formatDurationMilliseconds, formatInteger, formatShortDateTime } from '@/shared/lib/format';
import { StatePlacard } from '@/shared/ui/StatePlacard';

import type { ConversationTurn } from '../api/conversationTypes';
import { isHiddenFromVisitor, turnPlacard } from '../turnStatusModel';
import { MessageBlock } from './MessageBlock';
import { RetrievalTracePanel } from './RetrievalTracePanel';

export function TurnSection({ turn, turnNumber }: { turn: ConversationTurn; turnNumber: number }) {
  const placard = turnPlacard(turn);
  const isHidden = isHiddenFromVisitor(turn);
  return (
    <section
      aria-label={`Turn ${String(turnNumber)}`}
      className={joinClassNames('rounded-md border border-border bg-surface', isHidden && 'opacity-70')}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-primary">Turn {turnNumber}</h2>
          <StatePlacard state={placard.state} label={placard.label} />
          {turn.failureCode ? <code className="text-xs text-critical-text">{turn.failureCode}</code> : null}
        </div>
        <span className="tabular text-xs text-muted">{formatShortDateTime(turn.createdAt)}</span>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {isHidden ? <p className="text-xs text-muted">Hidden from the visitor; kept for review.</p> : null}
        <TurnFacts turn={turn} />
        {turn.rewrittenQueries.length > 0 ? <RewrittenQueries queries={turn.rewrittenQueries} /> : null}
        <div className="flex flex-col">
          {turn.messages.map((message) => (
            <MessageBlock key={message.id} message={message} />
          ))}
        </div>
        <RetrievalTracePanel rawTrace={turn.retrievalTrace} />
      </div>
    </section>
  );
}

function TurnFacts({ turn }: { turn: ConversationTurn }) {
  const facts: { label: string; value: string }[] = [
    { label: 'Model', value: turn.servedByModel ?? '—' },
    {
      label: 'Settings version',
      value: turn.chatbotSettingsVersion === null ? '—' : `v${String(turn.chatbotSettingsVersion)}`,
    },
    {
      label: 'Tokens',
      value: `${formatInteger(turn.usage.inputTokens)} in, ${formatInteger(turn.usage.outputTokens)} out, ${formatInteger(turn.usage.reasoningTokens)} reasoning`,
    },
    { label: 'First token', value: formatDurationMilliseconds(turn.timings.ttftMs) },
    { label: 'Total', value: formatDurationMilliseconds(turn.timings.totalMs) },
  ];
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {facts.map((fact) => (
        <div key={fact.label} className="flex gap-1.5">
          <dt className="text-muted">{fact.label}</dt>
          <dd className="tabular text-secondary">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RewrittenQueries({ queries }: { queries: readonly string[] }) {
  return (
    <div className="text-sm">
      <h3 className="text-xs font-medium text-muted">Search queries after rewriting</h3>
      <ol className="mt-1 list-decimal pl-5 text-secondary">
        {queries.map((query, queryIndex) => (
          <li key={`${String(queryIndex)}-${query}`}>{query}</li>
        ))}
      </ol>
    </div>
  );
}
