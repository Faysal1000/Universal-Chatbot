import { Plus } from 'lucide-react';
import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { Dialog } from '@/shared/ui/Dialog';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner, WarningBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import {
  useBuildIndexVersion,
  useCreateIndexVersion,
  useDeleteIndexVersion,
  useIndexVersions,
  usePromoteIndexVersion,
} from './api/indexVersionQueries';
import type { IndexVersion } from './api/indexVersionTypes';
import { IndexVersionsTable } from './components/IndexVersionsTable';
import { findLiveVersion, hasBuildInProgress, isRollback } from './indexVersionModel';

type PendingConfirmation =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'promote'; version: IndexVersion }
  | { kind: 'delete'; version: IndexVersion };

export function IndexVersionsPage() {
  const indexVersionsQuery = useIndexVersions();
  const buildMutation = useBuildIndexVersion();
  const { showToast } = useToast();
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>({ kind: 'none' });
  const versions = indexVersionsQuery.data ?? [];
  const liveVersion = findLiveVersion(versions);
  const closeConfirmation = () => setPendingConfirmation({ kind: 'none' });

  const build = (version: IndexVersion) => {
    buildMutation.mutate(version.id, {
      onSuccess: () =>
        showToast(`Building v${String(version.id)}: documents missing from it are being indexed.`, 'success'),
      onError: (error) => showToast(describeError(error), 'error'),
    });
  };

  return (
    <>
      <PageHeader
        title="Index versions"
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            disabled={hasBuildInProgress(versions)}
            title={hasBuildInProgress(versions) ? 'Another version is still building.' : undefined}
            onClick={() => setPendingConfirmation({ kind: 'create' })}
          >
            Build new version
          </Button>
        }
      />
      {indexVersionsQuery.isPending ? (
        <LoadingState label="Loading index versions…" />
      ) : indexVersionsQuery.isError ? (
        <ErrorBanner
          title="Could not load index versions"
          message={describeError(indexVersionsQuery.error)}
          onRetry={() => void indexVersionsQuery.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {liveVersion ? null : <NoLiveVersionWarning />}
          <Card bodyClassName="p-0">
            {versions.length === 0 ? (
              <EmptyState title="No index versions yet" />
            ) : (
              <IndexVersionsTable
                versions={versions}
                liveVersion={liveVersion}
                buildingVersionId={buildMutation.isPending ? buildMutation.variables : null}
                onBuild={build}
                onPromote={(version) => setPendingConfirmation({ kind: 'promote', version })}
                onDelete={(version) => setPendingConfirmation({ kind: 'delete', version })}
              />
            )}
          </Card>
        </div>
      )}
      <CreateVersionDialog isOpen={pendingConfirmation.kind === 'create'} onClose={closeConfirmation} />
      <PromoteVersionDialog
        version={pendingConfirmation.kind === 'promote' ? pendingConfirmation.version : null}
        liveVersion={liveVersion}
        onClose={closeConfirmation}
      />
      <DeleteVersionDialog
        version={pendingConfirmation.kind === 'delete' ? pendingConfirmation.version : null}
        onClose={closeConfirmation}
      />
    </>
  );
}

function NoLiveVersionWarning() {
  return (
    <WarningBanner>
      No version is live, so every question gets the fallback message. Promote a ready version.
    </WarningBanner>
  );
}

function CreateVersionDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const createMutation = useCreateIndexVersion();
  const { showToast } = useToast();
  const create = () => {
    createMutation.mutate(undefined, {
      onSuccess: (version) => {
        showToast(`Building v${String(version.id)}.`, 'success');
        onClose();
      },
    });
  };
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Build a new index version?"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={createMutation.isPending} onClick={create}>
            Build new version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-secondary">
        <p>
          A new version is built with the embedding model the embedding server serves now and the current chunker. Every
          ready document is chunked and embedded again, which can take a long time on CPU.
        </p>
        <p>The live version keeps answering until you promote the new one.</p>
        {createMutation.isError ? <ErrorBanner message={describeError(createMutation.error)} /> : null}
      </div>
    </Dialog>
  );
}

function PromoteVersionDialog({
  version,
  liveVersion,
  onClose,
}: {
  version: IndexVersion | null;
  liveVersion: IndexVersion | undefined;
  onClose: () => void;
}) {
  const promoteMutation = usePromoteIndexVersion();
  const { showToast } = useToast();
  const isRollingBack = version !== null && isRollback(version, liveVersion);
  const promote = () => {
    if (!version) return;
    promoteMutation.mutate(version.id, {
      onSuccess: () => {
        showToast(`v${String(version.id)} is live.`, 'success');
        onClose();
      },
    });
  };
  return (
    <ConfirmDialog
      isOpen={version !== null}
      title={isRollingBack ? `Roll back to v${String(version.id)}?` : `Promote v${String(version?.id ?? '')} to live?`}
      message={
        <>
          <p>
            Answers switch to this version in one atomic step: the next question is answered from it, and no question
            sees a half-switched index.
          </p>
          <p>
            {liveVersion
              ? `v${String(liveVersion.id)} is retired but kept, so you can promote it again to undo this.`
              : 'No version is live now.'}
          </p>
        </>
      }
      confirmLabel={isRollingBack ? 'Roll back' : 'Promote to live'}
      isConfirming={promoteMutation.isPending}
      errorMessage={promoteMutation.isError ? describeError(promoteMutation.error) : null}
      onConfirm={promote}
      onCancel={() => {
        promoteMutation.reset();
        onClose();
      }}
    />
  );
}

function DeleteVersionDialog({ version, onClose }: { version: IndexVersion | null; onClose: () => void }) {
  const deleteMutation = useDeleteIndexVersion();
  const { showToast } = useToast();
  const deleteVersion = () => {
    if (!version) return;
    deleteMutation.mutate(version.id, {
      onSuccess: () => {
        showToast(`v${String(version.id)} deleted.`, 'success');
        onClose();
      },
    });
  };
  return (
    <ConfirmDialog
      isOpen={version !== null}
      title={`Delete v${String(version?.id ?? '')}?`}
      message={<p>Its chunks and vectors are deleted permanently. You can no longer roll back to this version.</p>}
      confirmLabel="Delete version"
      isConfirming={deleteMutation.isPending}
      errorMessage={deleteMutation.isError ? describeError(deleteMutation.error) : null}
      onConfirm={deleteVersion}
      onCancel={() => {
        deleteMutation.reset();
        onClose();
      }}
    />
  );
}
