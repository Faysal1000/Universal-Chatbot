import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { formatDateTime, MISSING_VALUE_PLACEHOLDER } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';
import { useToast } from '@/shared/ui/toastContext';

import { useActivateChatbotSettingsVersion } from '../api/chatbotSettingsQueries';
import type { ChatbotSettingsVersion } from '../api/chatbotSettingsTypes';
import { listSettingChanges, settingsOfVersion } from '../chatbotSettingsFormModel';
import type { SettingChange } from '../chatbotSettingsFormModel';
import { changesFromPreviousVersion, settingsVersionAuthor, settingsVersionPlacard } from '../settingsVersionModel';
import { SettingChangesList } from './SettingChangesList';

/** The newest versions listed before the operator asks for the rest; the active one is always listed. */
const VERSIONS_SHOWN_AT_FIRST = 10;

export interface SettingsVersionHistoryProps {
  /** Newest first, as rag lists them. */
  versions: readonly ChatbotSettingsVersion[];
}

/** Every saved version; activating an older one is the rollback. Nothing is ever deleted. */
export function SettingsVersionHistory({ versions }: SettingsVersionHistoryProps) {
  const [versionToActivate, setVersionToActivate] = useState<ChatbotSettingsVersion | null>(null);
  const [isShowingOlderVersions, setIsShowingOlderVersions] = useState(false);
  const newestVersions = versions.filter((version, index) => index < VERSIONS_SHOWN_AT_FIRST || version.isActive);
  const olderVersionCount = versions.length - newestVersions.length;
  const shownVersions = isShowingOlderVersions ? versions : newestVersions;
  const changesByVersion = changesFromPreviousVersion(versions);
  const activeVersion = versions.find((version) => version.isActive);

  return (
    <>
      <Table caption="Settings versions">
        <thead>
          <tr>
            <HeaderCell>Version</HeaderCell>
            <HeaderCell>State</HeaderCell>
            <HeaderCell>Saved</HeaderCell>
            <HeaderCell>Saved by</HeaderCell>
            <HeaderCell>Changed from the version before</HeaderCell>
            <HeaderCell>Note</HeaderCell>
            <HeaderCell>
              <span className="sr-only">Actions</span>
            </HeaderCell>
          </tr>
        </thead>
        <tbody>
          {shownVersions.map((version) => (
            <SettingsVersionRow
              key={version.version}
              version={version}
              changes={changesByVersion.get(version.version) ?? null}
              onActivate={() => setVersionToActivate(version)}
            />
          ))}
        </tbody>
      </Table>
      {olderVersionCount > 0 ? (
        <div className="flex justify-center border-t border-border p-3">
          <Button onClick={() => setIsShowingOlderVersions(!isShowingOlderVersions)}>
            {isShowingOlderVersions ? 'Show fewer versions' : `Show ${olderVersionCount} older versions`}
          </Button>
        </div>
      ) : null}
      <ActivateVersionDialog
        versionToActivate={versionToActivate}
        activeVersion={activeVersion}
        onClose={() => setVersionToActivate(null)}
      />
    </>
  );
}

function SettingsVersionRow({
  version,
  changes,
  onActivate,
}: {
  version: ChatbotSettingsVersion;
  changes: SettingChange[] | null;
  onActivate: () => void;
}) {
  const placard = settingsVersionPlacard(version);
  return (
    <tr className={version.isActive ? 'bg-surface-selected' : 'hover:bg-surface-hover'}>
      <DataCell className="tabular font-medium whitespace-nowrap text-primary">Version {version.version}</DataCell>
      <DataCell>
        <StatePlacard state={placard.state} label={placard.label} />
      </DataCell>
      <DataCell className="tabular whitespace-nowrap">{formatDateTime(version.createdAt)}</DataCell>
      <DataCell className="whitespace-nowrap" title={version.createdByAdminUserId ?? undefined}>
        {settingsVersionAuthor(version)}
      </DataCell>
      <DataCell className="max-w-96 text-xs">{describeChangedSettings(changes)}</DataCell>
      <DataCell className="max-w-80 text-xs break-words">
        {version.note ?? <span className="text-muted">{MISSING_VALUE_PLACEHOLDER}</span>}
      </DataCell>
      <DataCell className="text-right">
        {version.isActive ? null : (
          <Button size="small" onClick={onActivate}>
            Activate
          </Button>
        )}
      </DataCell>
    </tr>
  );
}

function describeChangedSettings(changes: SettingChange[] | null): string {
  if (changes === null) return 'Oldest listed version';
  if (changes.length === 0) return 'Same settings (re-saved)';
  return changes.map((change) => change.label).join(', ');
}

function ActivateVersionDialog({
  versionToActivate,
  activeVersion,
  onClose,
}: {
  versionToActivate: ChatbotSettingsVersion | null;
  activeVersion: ChatbotSettingsVersion | undefined;
  onClose: () => void;
}) {
  const activateMutation = useActivateChatbotSettingsVersion();
  const { showToast } = useToast();
  const changes =
    versionToActivate && activeVersion
      ? listSettingChanges(settingsOfVersion(activeVersion), settingsOfVersion(versionToActivate))
      : [];

  const confirmActivation = () => {
    if (!versionToActivate) return;
    activateMutation.mutate(versionToActivate.version, {
      onSuccess: (activated) => {
        showToast(`Version ${activated.version} is active now.`, 'success');
        onClose();
      },
    });
  };

  return (
    <ConfirmDialog
      isOpen={versionToActivate !== null}
      title={`Activate version ${versionToActivate?.version ?? ''}?`}
      message={
        <>
          <p>
            The chatbot switches to these settings for every new answer at once. Version {activeVersion?.version ?? ''}{' '}
            stays in the history and can be activated again.
          </p>
          {changes.length > 0 ? (
            <SettingChangesList changes={changes} />
          ) : (
            <p>The settings are the same as the active version.</p>
          )}
        </>
      }
      confirmLabel={`Activate version ${versionToActivate?.version ?? ''}`}
      isConfirming={activateMutation.isPending}
      errorMessage={activateMutation.isError ? describeError(activateMutation.error) : null}
      onConfirm={confirmActivation}
      onCancel={() => {
        activateMutation.reset();
        onClose();
      }}
    />
  );
}
