import { Check, Clock, Copy, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import type { PendingUserMessage, UserMessageView } from '@chat-core/features/chat/chatThreadModel';
import { useComposerUiStore } from '@chat-core/features/composer/composerUiStore';
import { useCopyToClipboard } from '@chat-core/shared/hooks/useCopyToClipboard';
import { IconButton } from '@chat-core/shared/ui/IconButton';
import { cn } from '@chat-core/shared/ui/cn';

import { InlineMessageEditor } from './InlineMessageEditor';
import { MessageAttachments } from './MessageAttachments';

function BubbleText({ content, isPending }: { content: string; isPending?: boolean }) {
  if (!content) return null;
  return (
    <div
      className={cn(
        'max-w-full rounded-3xl bg-bubble-user px-4 py-2.5 leading-relaxed break-words whitespace-pre-wrap text-ink',
        isPending && 'border border-dashed border-line-strong bg-transparent',
      )}
    >
      {content}
    </div>
  );
}

interface SentUserMessageProps {
  turnId: string;
  message: UserMessageView;
  /** Only the latest turn can be edited and resent (the server refuses to replace older turns). */
  canEdit: boolean;
}

/** A sent user message: copy, and edit-and-resend for the latest turn. */
export function SentUserMessage({ turnId, message, canEdit }: SentUserMessageProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const { copied, copy } = useCopyToClipboard();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="group flex flex-col items-end" data-testid="user-message">
      <span className="sr-only">{t('message.you')}:</span>
      <MessageAttachments attachments={message.attachments} />
      {isEditing ? (
        <InlineMessageEditor
          initialValue={message.content}
          submitLabel={t('message.save')}
          onCancel={() => setIsEditing(false)}
          onSubmit={(value) => {
            setIsEditing(false);
            controller.editAndResend(turnId, message.clientMessageId, value);
          }}
        />
      ) : (
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
          <BubbleText content={message.content} />
          <div className="mt-1 flex gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            <IconButton
              size="sm"
              label={copied ? t('message.copied') : t('message.copy')}
              icon={copied ? <Check /> : <Copy />}
              onClick={() => void copy(message.content)}
            />
            {canEdit && message.content && (
              <IconButton
                size="sm"
                label={t('message.edit')}
                icon={<Pencil />}
                onClick={() => setIsEditing(true)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A message still waiting in the batching window: shown immediately, editable and removable until sent. */
export function PendingUserMessageBubble({ message }: { message: PendingUserMessage }) {
  const { t } = useTranslation();
  const controller = useChatController();
  const editingPendingId = useComposerUiStore((state) => state.editingPendingId);
  const startEditingPending = useComposerUiStore((state) => state.startEditingPending);
  const requestFocus = useComposerUiStore((state) => state.requestFocus);
  const isEditing = editingPendingId === message.clientMessageId;

  const stopEditing = () => {
    startEditingPending(null);
    requestFocus();
  };

  return (
    <div className="group flex flex-col items-end" data-testid="pending-message">
      <MessageAttachments attachments={message.attachments} />
      {isEditing ? (
        <InlineMessageEditor
          initialValue={message.content}
          submitLabel={t('message.saveDraft')}
          onActivity={() => controller.noteTyping()}
          onCancel={stopEditing}
          onSubmit={(value) => {
            controller.editPendingMessage(message.clientMessageId, value);
            stopEditing();
          }}
        />
      ) : (
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
          <BubbleText content={message.content} isPending />
          <div className="mt-1 flex items-center gap-0.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs text-ink-subtle">
              <Clock className="size-3" aria-hidden />
              {t('batch.queued')}
            </span>
            {message.content && (
              <IconButton
                size="sm"
                label={t('batch.edit')}
                icon={<Pencil />}
                onClick={() => startEditingPending(message.clientMessageId)}
              />
            )}
            <IconButton
              size="sm"
              label={t('batch.remove')}
              icon={<Trash2 />}
              onClick={() => controller.removePendingMessage(message.clientMessageId)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
