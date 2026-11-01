import type { RetrievalStage } from '@chat-core/api/chatApiContract';
import type { ReplyPhase } from '@chat-core/features/chat/chatThreadModel';
import type { OrbState } from '@chat-core/features/thinking/thinking-orb';

/**
 * Maps what the assistant is doing to one of the thinking-orbs animations
 * (thinking-orbs by Jakub Antalik, MIT — https://github.com/Jakubantalik/thinking-orbs).
 */
export function orbStateForReply(phase: ReplyPhase, stage: RetrievalStage | null): OrbState {
  if (phase === 'thinking') return 'working';
  switch (stage) {
    case 'rewriting':
      return 'shaping';
    case 'retrieving':
      return 'searching';
    case 'generating':
      return 'composing';
    case 'queued':
    case null:
      return 'breathing';
  }
}
