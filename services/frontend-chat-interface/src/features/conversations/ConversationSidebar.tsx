import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, PanelLeftClose, Pencil, Search, SquarePen, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import type { Conversation } from '@chat-core/api/chatApiContract';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { useChatStore } from '@chat-core/features/chat/chatStore';
import { ThinkingOrb } from '@chat-core/features/thinking/thinking-orb';
import { IconButton } from '@chat-core/shared/ui/IconButton';
import { cn } from '@chat-core/shared/ui/cn';
import { showToast } from '@chat-core/shared/ui/toastStore';

import { groupConversationsByDate } from './groupConversationsByDate';

export const CONVERSATION_SEARCH_INPUT_ID = 'conversation-search';
const SEARCH_DEBOUNCE_MS = 250;
const MAX_TITLE_LENGTH = 200;

interface ConversationSidebarProps {
  botName: string;
  logoUrl: string | null;
  onNavigate: () => void;
  onClose: () => void;
}

export function ConversationSidebar({ botName, logoUrl, onNavigate, onClose }: ConversationSidebarProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const conversations = useChatStore((state) => state.conversations);
  const status = useChatStore((state) => state.conversationsStatus);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);

  // Server-side search (titles and message content), debounced and cancelled on each keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      controller
        .searchConversations(trimmed, abort.signal)
        .then(setSearchResults)
        .catch(() => undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, controller]);

  // Results of an older query are never shown once the box is cleared.
  const visibleResults = query.trim() ? searchResults : null;
  const groups = useMemo(() => groupConversationsByDate(conversations), [conversations]);

  const openConversation = (conversationId: string | null) => {
    void controller.openConversation(conversationId);
    onNavigate();
  };

  return (
    <nav aria-label={t('sidebar.title')} className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2 px-1">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="size-7 rounded-lg object-contain" />
          ) : (
            <ThinkingOrb state="breathing" size={20} paused aria-hidden />
          )}
          <span className="truncate font-semibold text-ink">{botName}</span>
        </div>
        <IconButton
          label={t('sidebar.close')}
          icon={<PanelLeftClose />}
          onClick={onClose}
          tooltipSide="bottom"
        />
      </div>

      <div className="space-y-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => openConversation(null)}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface"
        >
          <SquarePen className="size-4" aria-hidden />
          {t('sidebar.newChat')}
          <kbd className="ml-auto hidden font-sans text-xs text-ink-subtle sm:inline">⇧⌘O</kbd>
        </button>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden
          />
          <label htmlFor={CONVERSATION_SEARCH_INPUT_ID} className="sr-only">
            {t('sidebar.search')}
          </label>
          <input
            id={CONVERSATION_SEARCH_INPUT_ID}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            className="w-full rounded-xl border border-line bg-canvas py-2 pr-8 pl-9 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-line-strong [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label={t('message.cancel')}
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-subtle hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visibleResults !== null ? (
          visibleResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              {t('sidebar.noResults', { query: query.trim() })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {visibleResults.map((conversation) => (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  onOpen={openConversation}
                  onDelete={setPendingDelete}
                />
              ))}
            </ul>
          )
        ) : status === 'error' ? (
          <p className="px-3 py-6 text-center text-sm text-danger">{t('sidebar.loadFailed')}</p>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">{t('sidebar.empty')}</p>
        ) : (
          groups.map(({ group, conversations: items }) => (
            <section key={group} aria-labelledby={`group-${group}`} className="mt-3 first:mt-1">
              <h2 id={`group-${group}`} className="px-3 pb-1 text-xs font-medium text-ink-subtle">
                {t(`sidebar.groups.${group}`)}
              </h2>
              <ul className="space-y-0.5">
                {items.map((conversation) => (
                  <ConversationListItem
                    key={conversation.id}
                    conversation={conversation}
                    onOpen={openConversation}
                    onDelete={setPendingDelete}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('sidebar.deleteTitle')}
        description={t('sidebar.deleteDescription', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('sidebar.confirmDelete')}
        cancelLabel={t('sidebar.cancel')}
        destructive
        onConfirm={() => {
          if (!pendingDelete) return;
          controller
            .deleteConversation(pendingDelete.id)
            .catch(() => showToast(t('toast.deleteFailed'), 'error'));
        }}
      />
    </nav>
  );
}

interface ConversationListItemProps {
  conversation: Conversation;
  onOpen: (conversationId: string) => void;
  onDelete: (conversation: Conversation) => void;
}

function ConversationListItem({ conversation, onOpen, onDelete }: ConversationListItemProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const isActive = useChatStore((state) => state.activeConversationKey === conversation.id);
  const isStreaming = useChatStore((state) => state.streamingTurn?.conversationKey === conversation.id);
  const hasPending = useChatStore((state) => (state.batches[conversation.id]?.pending.length ?? 0) > 0);
  const [isRenaming, setIsRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRequested = useRef(false);

  useEffect(() => {
    if (isRenaming) inputRef.current?.select();
  }, [isRenaming]);

  const commitRename = () => {
    setIsRenaming(false);
    if (title.trim() && title.trim() !== conversation.title) {
      controller
        .renameConversation(conversation.id, title)
        .catch(() => showToast(t('toast.renameFailed'), 'error'));
    } else {
      setTitle(conversation.title);
    }
  };

  if (isRenaming) {
    return (
      <li>
        <input
          ref={inputRef}
          value={title}
          aria-label={t('sidebar.renameLabel')}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') {
              setTitle(conversation.title);
              setIsRenaming(false);
            }
          }}
          className="w-full rounded-lg border border-accent bg-canvas px-3 py-1.5 text-sm text-ink outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(conversation.id)}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg py-2 pr-9 pl-3 text-left text-sm transition-colors',
          isActive ? 'bg-surface font-medium text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink',
        )}
      >
        <span className="truncate">{conversation.title}</span>
        {(isStreaming || hasPending) && (
          <span
            className={cn(
              'ml-auto size-1.5 shrink-0 rounded-full',
              isStreaming ? 'animate-pulse bg-accent' : 'bg-warning',
            )}
            aria-hidden
          />
        )}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={t('sidebar.options')}
            className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted opacity-100 transition-opacity hover:bg-canvas hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              // Returning focus to the trigger would blur (and commit) the rename input immediately.
              if (renameRequested.current) event.preventDefault();
              renameRequested.current = false;
            }}
            className="z-50 min-w-40 rounded-xl border border-line bg-canvas p-1 shadow-elevated"
          >
            <DropdownMenu.Item
              onSelect={() => {
                setTitle(conversation.title);
                renameRequested.current = true;
                setIsRenaming(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-highlighted:bg-surface"
            >
              <Pencil className="size-4" aria-hidden />
              {t('sidebar.rename')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onDelete(conversation)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger outline-none data-highlighted:bg-danger-soft"
            >
              <Trash2 className="size-4" aria-hidden />
              {t('sidebar.delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}
