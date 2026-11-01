/** How saved settings versions read in the history: state, author and what each one changed. */
import type { StatusPlacard } from '../shared/statusPlacard';
import type { ChatbotSettingsVersion } from './api/chatbotSettingsTypes';
import { listSettingChanges, settingsOfVersion } from './chatbotSettingsFormModel';
import type { SettingChange } from './chatbotSettingsFormModel';

const ADMIN_ID_PREFIX_LENGTH = 8;

/** The active version is marked as such; every other version is kept, voided rather than erased. */
export function settingsVersionPlacard(version: Pick<ChatbotSettingsVersion, 'isActive'>): StatusPlacard {
  return version.isActive ? { state: 'ready', label: 'Active' } : { state: 'stopped', label: 'Superseded' };
}

/** rag stores no author for the seeded version or for saves made with the service API key. */
export function settingsVersionAuthor(version: Pick<ChatbotSettingsVersion, 'createdByAdminUserId'>): string {
  const adminUserId = version.createdByAdminUserId;
  return adminUserId === null ? 'Seed or API key' : `Admin ${adminUserId.slice(0, ADMIN_ID_PREFIX_LENGTH)}`;
}

/**
 * What each version changed compared with the version saved just before it.
 * `versions` is newest first, as rag lists them; the oldest listed version has no predecessor.
 */
export function changesFromPreviousVersion(
  versions: readonly ChatbotSettingsVersion[],
): Map<number, SettingChange[] | null> {
  const changesByVersion = new Map<number, SettingChange[] | null>();
  versions.forEach((version, index) => {
    const previousVersion = versions[index + 1];
    changesByVersion.set(
      version.version,
      previousVersion ? listSettingChanges(settingsOfVersion(previousVersion), settingsOfVersion(version)) : null,
    );
  });
  return changesByVersion;
}
