import type { ReactNode } from 'react';

import { Button } from './Button';
import { Dialog } from './Dialog';
import { ErrorBanner } from './StatusMessages';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  isConfirming: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for destructive actions; shows the backend's reason when it refuses (e.g. 409). */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  isConfirming,
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" isLoading={isConfirming} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-secondary">
        {message}
        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      </div>
    </Dialog>
  );
}
