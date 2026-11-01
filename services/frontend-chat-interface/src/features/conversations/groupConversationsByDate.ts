import type { Conversation } from '@chat-core/api/chatApiContract';

export type ConversationDateGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';

const DAY_MS = 86_400_000;
const GROUP_ORDER: readonly ConversationDateGroup[] = ['today', 'yesterday', 'week', 'month', 'older'];

function dateGroupOf(updatedAt: number, startOfToday: number): ConversationDateGroup {
  if (updatedAt >= startOfToday) return 'today';
  if (updatedAt >= startOfToday - DAY_MS) return 'yesterday';
  if (updatedAt >= startOfToday - 7 * DAY_MS) return 'week';
  if (updatedAt >= startOfToday - 30 * DAY_MS) return 'month';
  return 'older';
}

/** Buckets conversations (already sorted newest first) by last activity, relative to local midnight. */
export function groupConversationsByDate(
  conversations: readonly Conversation[],
  now: Date = new Date(),
): { group: ConversationDateGroup; conversations: Conversation[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = new Map<ConversationDateGroup, Conversation[]>();
  for (const conversation of conversations) {
    const group = dateGroupOf(Date.parse(conversation.updatedAt), startOfToday);
    groups.set(group, [...(groups.get(group) ?? []), conversation]);
  }
  return GROUP_ORDER.flatMap((group) => {
    const items = groups.get(group);
    return items ? [{ group, conversations: items }] : [];
  });
}
