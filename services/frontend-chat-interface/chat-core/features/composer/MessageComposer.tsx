import { ArrowUp, ImagePlus, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_IMAGE_LIMITS } from '@chat-core/features/attachments/imageAttachmentValidation';
import type { useImageAttachmentDrafts } from '@chat-core/features/attachments/useImageAttachmentDrafts';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { selectActiveBatch, useChatStore } from '@chat-core/features/chat/chatStore';
import { isImeComposing } from '@chat-core/shared/isImeComposing';
import { IconButton } from '@chat-core/shared/ui/IconButton';
import { cn } from '@chat-core/shared/ui/cn';

import { AttachmentPreviewTray } from './AttachmentPreviewTray';
import { useComposerUiStore } from './composerUiStore';

interface MessageComposerProps {
  attachments: ReturnType<typeof useImageAttachmentDrafts>;
  botName: string;
}

const MAX_TEXTAREA_HEIGHT_PX = 240;
/** Until `/config` arrives with the admin's limit. */
const DEFAULT_MAX_MESSAGE_CHARS = 700;
/** The character counter appears once the text reaches this share of the limit. */
const CHARACTER_COUNT_THRESHOLD = 0.8;

/**
 * Message input. Sending never calls the model directly: it hands the message to the batch scheduler,
 * and every keystroke tells the scheduler the user is still typing. While a reply is on its way the
 * only action is Stop, so a conversation never has two questions in flight.
 */
export function MessageComposer({ attachments, botName }: MessageComposerProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = useChatStore((state) => state.config);
  const isAwaitingReply = useChatStore(
    (state) =>
      state.streamingTurn?.conversationKey === state.activeConversationKey ||
      selectActiveBatch(state)?.isHeld === true,
  );
  const pending = useChatStore((state) => selectActiveBatch(state)?.pending);
  const activeConversationKey = useChatStore((state) => state.activeConversationKey);
  const focusRequest = useComposerUiStore((state) => state.focusRequest);
  const startEditingPending = useComposerUiStore((state) => state.startEditingPending);

  const maxChars = config?.limits.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  const isTooLong = text.length > maxChars;
  const hasContent = text.trim().length > 0 || attachments.drafts.some((d) => d.status === 'uploaded');
  const canSend = hasContent && !isTooLong && !attachments.isUploading && !isAwaitingReply;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? 'auto' : 'hidden';
  }, [text]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusRequest, activeConversationKey]);

  const send = () => {
    if (!canSend) return;
    controller.sendMessage(text, attachments.takeUploaded());
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === 'ArrowUp' && text === '' && pending && pending.length > 0) {
      event.preventDefault();
      startEditingPending(pending.at(-1)?.clientMessageId ?? null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void attachments.addFiles(files);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        className={cn(
          'rounded-3xl border bg-surface-raised shadow-elevated transition-colors focus-within:border-line-strong',
          isTooLong ? 'border-danger' : 'border-line',
        )}
      >
        <AttachmentPreviewTray
          drafts={attachments.drafts}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
        />
        <label htmlFor="message-composer" className="sr-only">
          {t('composer.label')}
        </label>
        <textarea
          id="message-composer"
          ref={textareaRef}
          value={text}
          rows={1}
          placeholder={t('composer.placeholder', { botName })}
          onChange={(event) => {
            setText(event.target.value);
            controller.noteTyping();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-describedby="composer-hint"
          aria-invalid={isTooLong}
          className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.975rem] leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={(config?.limits.allowedImageTypes ?? DEFAULT_IMAGE_LIMITS.allowedImageTypes).join(',')}
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void attachments.addFiles(Array.from(event.target.files));
                event.target.value = '';
              }}
            />
            <IconButton
              label={t('composer.attach')}
              icon={<ImagePlus />}
              onClick={() => fileInputRef.current?.click()}
            />
            {text.length > maxChars * CHARACTER_COUNT_THRESHOLD && (
              <span className={cn('text-xs tabular-nums', isTooLong ? 'text-danger' : 'text-ink-subtle')}>
                {t('composer.tooLong', { count: text.length, max: maxChars })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isAwaitingReply ? (
              <IconButton
                label={t('composer.stop')}
                icon={<Square className="fill-current" />}
                onClick={() => controller.stopGeneration()}
                className="rounded-full border border-line-strong text-ink hover:bg-surface"
              />
            ) : (
              <IconButton
                label={t('composer.send')}
                icon={<ArrowUp />}
                disabled={!canSend}
                onClick={send}
                className="rounded-full bg-accent text-accent-ink hover:bg-accent hover:text-accent-ink hover:opacity-90 disabled:bg-ink-subtle disabled:opacity-30"
              />
            )}
          </div>
        </div>
      </div>
      <p id="composer-hint" className="mt-1.5 hidden text-center text-xs text-ink-subtle sm:block">
        {t('composer.hint')}
      </p>
    </div>
  );
}
