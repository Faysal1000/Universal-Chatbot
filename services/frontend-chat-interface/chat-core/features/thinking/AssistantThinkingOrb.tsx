import type { RetrievalStage } from '@chat-core/api/chatApiContract';
import type { ReplyPhase } from '@chat-core/features/chat/chatThreadModel';
import { ThinkingOrb, type OrbSize } from '@chat-core/features/thinking/thinking-orb';

import { orbStateForReply } from './orbStateForReply';

interface AssistantThinkingOrbProps {
  phase: ReplyPhase;
  stage: RetrievalStage | null;
  size?: OrbSize;
  label: string;
  /** Freeze on a static frame (finished replies), so long threads don't animate dozens of canvases. */
  paused?: boolean;
}

export function AssistantThinkingOrb({
  phase,
  stage,
  size = 32,
  label,
  paused = false,
}: AssistantThinkingOrbProps) {
  return (
    <ThinkingOrb state={orbStateForReply(phase, stage)} size={size} paused={paused} aria-label={label} />
  );
}
