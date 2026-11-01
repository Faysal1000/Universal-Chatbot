import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@chat-core/features/chat/chatStore';
import { isImeComposing } from '@chat-core/shared/isImeComposing';

const MAX_EDITOR_HEIGHT_PX = 320;

interface InlineMessageEditorProps {
  initialValue: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onActivity?: () => void;
}

/** Textarea that replaces a message bubble while editing. Enter saves, Escape cancels. */
export function InlineMessageEditor({
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
  onActivity,
}: InlineMessageEditorProps) {
  const { t } = useTranslation();
  const maxMessageChars = useChatStore((state) => state.config?.limits.maxMessageChars);
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_EDITOR_HEIGHT_PX)}px`;
  }, [value]);

  return (
    <form
      className="w-full rounded-2xl border border-line-strong bg-surface-raised p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <textarea
        ref={ref}
        value={value}
        maxLength={maxMessageChars}
        aria-label={t('message.edit')}
        onChange={(event) => {
          setValue(event.target.value);
          onActivity?.();
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit(value);
          }
        }}
        className="block w-full resize-none bg-transparent px-2 py-1 leading-relaxed text-ink outline-none focus-visible:outline-none"
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          {t('message.cancel')}
        </button>
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
