import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Citation, PublicChatConfig } from '@chat-core/api/chatApiContract';
import { publicChatConfigSchema } from '@chat-core/api/chatApiContract';
import { ChatControllerContext } from '@chat-core/features/chat/ChatControllerContext';
import type { ChatController } from '@chat-core/features/chat/chatController';
import { initialChatStoreState, useChatStore } from '@chat-core/features/chat/chatStore';
import { createWaitingReply, type TurnView } from '@chat-core/features/chat/chatThreadModel';
import { TooltipProvider } from '@chat-core/shared/ui/Tooltip';

import { AssistantReply } from './AssistantReply';

const citation: Citation = {
  id: 'cit_1',
  marker: 1,
  kind: 'text',
  documentId: 'doc',
  documentTitle: 'Handbook.pdf',
  page: 3,
  snippet: 'Employees get 24 days.',
  bbox: null,
  hasPreview: false,
};

const answeredTurn: TurnView = {
  turnId: 't1',
  userMessages: [],
  reply: {
    ...createWaitingReply(),
    serverId: 'a1',
    phase: 'complete',
    finishReason: 'stop',
    content: 'Employees get 24 days of leave [1].',
    citations: [citation],
  },
};

function configWith(showSources: boolean | undefined): PublicChatConfig {
  return publicChatConfigSchema.parse({
    botName: 'Assistant',
    greeting: 'Hello',
    suggestedPrompts: [],
    turnstileSiteKey: null,
    ...(showSources === undefined ? {} : { showSources }),
    limits: {
      maxImageBytes: 5_242_880,
      allowedImageTypes: ['image/png'],
      maxImagesPerTurn: 4,
      maxMessagesPerTurn: 10,
      maxMessageChars: 8000,
    },
    features: { reasoning: false, feedback: true },
  });
}

function renderReply(showSources: boolean | undefined) {
  useChatStore.setState({ config: configWith(showSources) });
  return render(
    <ChatControllerContext.Provider value={{} as ChatController}>
      <TooltipProvider>
        <AssistantReply turn={answeredTurn} isLatest />
      </TooltipProvider>
    </ChatControllerContext.Provider>,
  );
}

afterEach(() => useChatStore.setState(initialChatStoreState));

describe('AssistantReply sources', () => {
  it('shows citation chips and the source list when sources are on', () => {
    renderReply(true);
    expect(screen.getAllByRole('button', { name: /Open source 1: Handbook\.pdf, page 3/ })).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
  });

  it('treats a config without showSources (an older rag) as sources on', () => {
    renderReply(undefined);
    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
  });

  it('hides every source UI and ignores citation data that arrives anyway when sources are off', () => {
    const { container } = renderReply(false);
    expect(screen.queryByRole('button', { name: /Open source/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(container.querySelector('.markdown-body')?.textContent).toBe('Employees get 24 days of leave .');
  });
});
