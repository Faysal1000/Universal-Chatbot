import { Ban } from 'lucide-react';
import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useClientBlocks, useDeleteClientBlock } from './api/clientBlockQueries';
import type { ClientBlock } from './api/clientBlockTypes';
import { describeBlockTarget } from './clientBlockFormModel';
import { ClientBlocksTable } from './components/ClientBlocksTable';
import { CreateClientBlockDialog } from './components/CreateClientBlockDialog';

export function ClientBlocksPage() {
  const clientBlocksQuery = useClientBlocks();
  const deleteBlockMutation = useDeleteClientBlock();
  const { showToast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [blockPendingLift, setBlockPendingLift] = useState<ClientBlock | null>(null);
  const nowEpochMilliseconds = clientBlocksQuery.dataUpdatedAt;

  const confirmLift = () => {
    if (!blockPendingLift) return;
    deleteBlockMutation.mutate(blockPendingLift.id, {
      onSuccess: () => {
        setBlockPendingLift(null);
        showToast('Block lifted.', 'success');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Client blocks"
        actions={
          <Button
            variant="primary"
            leadingIcon={<Ban aria-hidden="true" className="size-4" />}
            onClick={() => setIsCreateDialogOpen(true)}
          >
            Block a client
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        {clientBlocksQuery.isPending ? (
          <LoadingState label="Loading blocks…" />
        ) : clientBlocksQuery.isError ? (
          <div className="p-4">
            <ErrorBanner
              title="Could not load client blocks"
              message={describeError(clientBlocksQuery.error)}
              onRetry={() => void clientBlocksQuery.refetch()}
            />
          </div>
        ) : clientBlocksQuery.data.length === 0 ? (
          <EmptyState title="Nobody is blocked" />
        ) : (
          <ClientBlocksTable
            blocks={clientBlocksQuery.data}
            nowEpochMilliseconds={nowEpochMilliseconds}
            onLift={(block) => {
              deleteBlockMutation.reset();
              setBlockPendingLift(block);
            }}
          />
        )}
      </Card>

      <CreateClientBlockDialog isOpen={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} />
      <ConfirmDialog
        isOpen={blockPendingLift !== null}
        title="Lift this block?"
        message={
          <p>
            The blocked {blockPendingLift ? describeBlockTarget(blockPendingLift).toLowerCase() : 'client'} can use the
            public chat again right away. Reason it was blocked: {blockPendingLift?.reason}
          </p>
        }
        confirmLabel="Lift block"
        isConfirming={deleteBlockMutation.isPending}
        errorMessage={deleteBlockMutation.isError ? describeError(deleteBlockMutation.error) : null}
        onConfirm={confirmLift}
        onCancel={() => setBlockPendingLift(null)}
      />
    </>
  );
}
