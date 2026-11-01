import { useNavigate } from 'react-router';

import { ApiError, describeError } from '@/shared/api/httpClient';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { useToast } from '@/shared/ui/toastContext';

import { useDeleteConversation } from '../api/conversationQueries';
import type { ConversationDetail } from '../api/conversationTypes';

const CONVERSATION_ACTIVE_CODE = 'conversation_active';

/** Deletes the conversation; if a reply is still being written, the admin can force it, cancelling the reply. */
export function DeleteConversationDialog({
  conversation,
  isOpen,
  onClose,
}: {
  conversation: ConversationDetail;
  isOpen: boolean;
  onClose: () => void;
}) {
  const deleteMutation = useDeleteConversation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isReplyInProgress =
    deleteMutation.error instanceof ApiError && deleteMutation.error.code === CONVERSATION_ACTIVE_CODE;

  const close = () => {
    deleteMutation.reset();
    onClose();
  };
  const confirm = () => {
    deleteMutation.mutate(
      { conversationId: conversation.id, force: isReplyInProgress },
      {
        onSuccess: () => {
          showToast('Conversation deleted.', 'success');
          void navigate(ROUTE_PATHS.ragConversations);
        },
      },
    );
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="Delete this conversation?"
      message={
        <p>
          Its {conversation.turnCount} turns, messages, feedback and summary are removed for good. The visitor no longer
          sees it in their chat history.
        </p>
      }
      confirmLabel={isReplyInProgress ? 'Delete anyway' : 'Delete conversation'}
      isConfirming={deleteMutation.isPending}
      errorMessage={deleteMutation.isError ? describeError(deleteMutation.error) : null}
      onConfirm={confirm}
      onCancel={close}
    />
  );
}
