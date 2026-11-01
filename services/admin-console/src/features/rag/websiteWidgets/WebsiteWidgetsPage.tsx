import { Plus } from 'lucide-react';
import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useRevokeWidgetKey, useWidgetKeys } from './api/widgetKeyQueries';
import type { WidgetKey } from './api/widgetKeyTypes';
import { EmbedCodeDialog } from './components/EmbedCodeDialog';
import { WidgetKeyDialog } from './components/WidgetKeyDialog';
import { WidgetKeysTable } from './components/WidgetKeysTable';

/** Which dialog is open; one at a time. */
type OpenDialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; widgetKey: WidgetKey }
  | { kind: 'embed'; widgetKey: WidgetKey }
  | { kind: 'revoke'; widgetKey: WidgetKey };

export function WebsiteWidgetsPage() {
  const widgetKeysQuery = useWidgetKeys();
  const revokeMutation = useRevokeWidgetKey();
  const { showToast } = useToast();
  const [openDialog, setOpenDialog] = useState<OpenDialog>({ kind: 'none' });
  const closeDialog = () => setOpenDialog({ kind: 'none' });

  const confirmRevoke = () => {
    if (openDialog.kind !== 'revoke') return;
    revokeMutation.mutate(openDialog.widgetKey.id, {
      onSuccess: () => {
        closeDialog();
        showToast('Key revoked. The widget stops within seconds.', 'success');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Website widgets"
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => setOpenDialog({ kind: 'create' })}
          >
            Add a website
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        {widgetKeysQuery.isPending ? (
          <LoadingState label="Loading website keys…" />
        ) : widgetKeysQuery.isError ? (
          <div className="p-4">
            <ErrorBanner
              title="Could not load website keys"
              message={describeError(widgetKeysQuery.error)}
              onRetry={() => void widgetKeysQuery.refetch()}
            />
          </div>
        ) : widgetKeysQuery.data.length === 0 ? (
          <EmptyState title="No websites yet" description="Add a website to get its key and embed code." />
        ) : (
          <WidgetKeysTable
            widgetKeys={widgetKeysQuery.data}
            onShowEmbedCode={(widgetKey) => setOpenDialog({ kind: 'embed', widgetKey })}
            onEdit={(widgetKey) => setOpenDialog({ kind: 'edit', widgetKey })}
            onRevoke={(widgetKey) => {
              revokeMutation.reset();
              setOpenDialog({ kind: 'revoke', widgetKey });
            }}
          />
        )}
      </Card>

      <WidgetKeyDialog
        isOpen={openDialog.kind === 'create' || openDialog.kind === 'edit'}
        widgetKey={openDialog.kind === 'edit' ? openDialog.widgetKey : undefined}
        onClose={closeDialog}
        onCreated={(widgetKey) => setOpenDialog({ kind: 'embed', widgetKey })}
      />
      <EmbedCodeDialog widgetKey={openDialog.kind === 'embed' ? openDialog.widgetKey : null} onClose={closeDialog} />
      <ConfirmDialog
        isOpen={openDialog.kind === 'revoke'}
        title="Revoke this key?"
        message={
          <p>
            The chat disappears from {openDialog.kind === 'revoke' ? openDialog.widgetKey.name : 'the website'} within
            seconds and visitors there lose their open conversations. This cannot be undone; add the website again for a
            new key.
          </p>
        }
        confirmLabel="Revoke key"
        isConfirming={revokeMutation.isPending}
        errorMessage={revokeMutation.isError ? describeError(revokeMutation.error) : null}
        onConfirm={confirmRevoke}
        onCancel={closeDialog}
      />
    </>
  );
}
