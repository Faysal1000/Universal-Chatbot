import { useTranslation } from 'react-i18next';

import type { Attachment } from '@chat-core/api/chatApiContract';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';

/** Images sent with a user message. Their signed URLs expire, so a failed image asks for fresh URLs. */
export function MessageAttachments({ attachments }: { attachments: readonly Attachment[] }) {
  const { t } = useTranslation();
  const controller = useChatController();
  if (attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {attachments.map((attachment, index) => (
        <a
          key={attachment.id}
          href={controller.apiClient.resolveAssetUrl(attachment.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-2xl border border-line"
        >
          <img
            src={controller.apiClient.resolveAssetUrl(attachment.url)}
            alt={t('message.attachmentAlt', { index: index + 1 })}
            width={attachment.width || undefined}
            height={attachment.height || undefined}
            className="h-36 w-auto max-w-60 object-cover"
            loading="lazy"
            onError={() => controller.refreshAttachmentUrls(attachment.id)}
          />
        </a>
      ))}
    </div>
  );
}
