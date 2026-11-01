import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Attachment, ChatLimits } from '@chat-core/api/chatApiContract';
import { ChatApiError } from '@chat-core/api/chatApiError';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { showToast } from '@chat-core/shared/ui/toastStore';

import { DEFAULT_IMAGE_LIMITS, formatBytes, validateImageFile } from './imageAttachmentValidation';

export interface ImageAttachmentDraft {
  localId: string;
  file: File;
  previewUrl: string;
  status: 'uploading' | 'uploaded' | 'failed';
  progress: number;
  attachment: Attachment | null;
  errorMessage: string | null;
}

/**
 * Composer image state: validates, uploads immediately (with progress) so sending is instant, and cleans up
 * object URLs and in-flight uploads when an image is removed or the composer unmounts.
 */
export function useImageAttachmentDrafts(limits: ChatLimits | null) {
  const { t } = useTranslation();
  const controller = useChatController();
  const [drafts, setDrafts] = useState<ImageAttachmentDraft[]>([]);
  const uploads = useRef(new Map<string, AbortController>());
  // Async callbacks need the latest drafts without re-creating themselves on every progress tick.
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  const effectiveLimits = limits ?? DEFAULT_IMAGE_LIMITS;

  const patch = useCallback((localId: string, update: Partial<ImageAttachmentDraft>) => {
    setDrafts((current) => current.map((d) => (d.localId === localId ? { ...d, ...update } : d)));
  }, []);

  const startUpload = useCallback(
    (draft: ImageAttachmentDraft) => {
      const abort = new AbortController();
      uploads.current.set(draft.localId, abort);
      patch(draft.localId, { status: 'uploading', progress: 0, errorMessage: null });
      controller.apiClient
        .uploadAttachment(draft.file, {
          signal: abort.signal,
          onProgress: (progress) => patch(draft.localId, { progress }),
        })
        .then((attachment) => patch(draft.localId, { status: 'uploaded', progress: 1, attachment }))
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          const message =
            error instanceof ChatApiError ? t(`errors.${error.kind}`) : t('composer.uploadFailed');
          patch(draft.localId, { status: 'failed', errorMessage: message });
        })
        .finally(() => uploads.current.delete(draft.localId));
    },
    [controller, patch, t],
  );

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      let attachedCount = draftsRef.current.length;
      for (const file of files) {
        const result = await validateImageFile(file, attachedCount, effectiveLimits);
        if (!result.ok) {
          showToast(
            t(`composer.errors.${result.reason}`, {
              name: file.name || 'image',
              max:
                result.reason === 'count'
                  ? effectiveLimits.maxImagesPerTurn
                  : formatBytes(effectiveLimits.maxImageBytes),
            }),
            'error',
          );
          if (result.reason === 'count') break;
          continue;
        }
        attachedCount += 1;
        const draft: ImageAttachmentDraft = {
          localId: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'uploading',
          progress: 0,
          attachment: null,
          errorMessage: null,
        };
        setDrafts((current) => [...current, draft]);
        startUpload(draft);
      }
    },
    [effectiveLimits, startUpload, t],
  );

  const remove = useCallback((localId: string) => {
    uploads.current.get(localId)?.abort();
    setDrafts((current) => {
      const draft = current.find((d) => d.localId === localId);
      if (draft) URL.revokeObjectURL(draft.previewUrl);
      return current.filter((d) => d.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const draft = draftsRef.current.find((d) => d.localId === localId);
      if (draft) startUpload(draft);
    },
    [startUpload],
  );

  /** Hands uploaded attachments to the message and clears the tray; sent bubbles show the server URL. */
  const takeUploaded = useCallback((): Attachment[] => {
    const uploaded = draftsRef.current.flatMap((d) => (d.attachment ? [d.attachment] : []));
    for (const draft of draftsRef.current) URL.revokeObjectURL(draft.previewUrl);
    setDrafts([]);
    return uploaded;
  }, []);

  useEffect(
    () => () => {
      for (const abort of uploads.current.values()) abort.abort();
      for (const draft of draftsRef.current) URL.revokeObjectURL(draft.previewUrl);
    },
    [],
  );

  return {
    drafts,
    addFiles,
    remove,
    retry,
    takeUploaded,
    isUploading: drafts.some((d) => d.status === 'uploading'),
    hasFailed: drafts.some((d) => d.status === 'failed'),
  };
}
