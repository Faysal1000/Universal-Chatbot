import { AlertCircle, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ImageAttachmentDraft } from '@chat-core/features/attachments/useImageAttachmentDrafts';
import { cn } from '@chat-core/shared/ui/cn';

interface AttachmentPreviewTrayProps {
  drafts: readonly ImageAttachmentDraft[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}

/** Thumbnails of images attached to the message being composed, with upload progress and remove/retry. */
export function AttachmentPreviewTray({ drafts, onRemove, onRetry }: AttachmentPreviewTrayProps) {
  const { t } = useTranslation();
  if (drafts.length === 0) return null;
  return (
    <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label={t('composer.attach')}>
      {drafts.map((draft) => {
        const percent = Math.round(draft.progress * 100);
        return (
          <li key={draft.localId} className="group relative size-16 shrink-0">
            <img
              src={draft.previewUrl}
              alt={draft.file.name}
              className={cn(
                'size-16 rounded-xl border border-line object-cover',
                draft.status !== 'uploaded' && 'opacity-60',
              )}
            />
            {draft.status === 'uploading' && (
              <div
                role="progressbar"
                aria-label={t('composer.uploading', { percent })}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/25"
              >
                <div
                  className="h-full rounded-full bg-white transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {draft.status === 'failed' && (
              <button
                type="button"
                onClick={() => onRetry(draft.localId)}
                title={draft.errorMessage ?? t('composer.uploadFailed')}
                aria-label={`${draft.errorMessage ?? t('composer.uploadFailed')}. ${t('composer.retryUpload')}`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-danger/80 text-white"
              >
                <AlertCircle className="size-4" aria-hidden />
                <RotateCw className="size-3" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(draft.localId)}
              aria-label={t('composer.removeAttachment', { name: draft.file.name })}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-canvas text-ink shadow-sm transition-colors hover:bg-danger hover:text-white"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
