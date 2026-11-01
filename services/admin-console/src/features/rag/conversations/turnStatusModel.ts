import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { ConversationTurn } from './api/conversationTypes';

export interface TurnPlacard {
  state: PlacardState;
  label: string;
}

const COMPLETED_PLACARDS: Record<NonNullable<ConversationTurn['finishReason']> | 'unknown', TurnPlacard> = {
  stop: { state: 'ready', label: 'Answered' },
  length: { state: 'warning', label: 'Cut at the length limit' },
  no_evidence: { state: 'warning', label: 'No evidence (fallback)' },
  cancelled: { state: 'stopped', label: 'Stopped by the visitor' },
  unknown: { state: 'ready', label: 'Completed' },
};

const STATUS_PLACARDS: Record<Exclude<ConversationTurn['status'], 'completed'>, TurnPlacard> = {
  pending: { state: 'working', label: 'Pending' },
  running: { state: 'working', label: 'Answering' },
  superseded: { state: 'stopped', label: 'Superseded by an edit' },
  replaced: { state: 'stopped', label: 'Replaced by a regenerated answer' },
  cancelled: { state: 'stopped', label: 'Cancelled' },
  failed: { state: 'failed', label: 'Failed' },
};

/** A turn's outcome in the console's state vocabulary; a completed turn is told apart by why it finished. */
export function turnPlacard(turn: Pick<ConversationTurn, 'status' | 'finishReason'>): TurnPlacard {
  if (turn.status === 'completed') return COMPLETED_PLACARDS[turn.finishReason ?? 'unknown'];
  return STATUS_PLACARDS[turn.status];
}

/** Superseded and replaced turns are no longer shown to the visitor. */
export function isHiddenFromVisitor(turn: Pick<ConversationTurn, 'status'>): boolean {
  return turn.status === 'superseded' || turn.status === 'replaced';
}
