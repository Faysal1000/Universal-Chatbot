import { describe, expect, it } from 'vitest';

import type { ChatbotSettingsVersion } from './api/chatbotSettingsTypes';
import { changesFromPreviousVersion, settingsVersionAuthor, settingsVersionPlacard } from './settingsVersionModel';

function aVersion(version: number, overrides: Partial<ChatbotSettingsVersion> = {}): ChatbotSettingsVersion {
  return {
    botName: 'Nodi',
    greetingMessage: 'Hello!',
    suggestedPrompts: [],
    systemInstruction: 'Answer briefly.',
    fallbackMessage: 'Not found.',
    answerOnlyFromDocuments: true,
    answerTemperature: 0.2,
    maxAnswerTokens: 1024,
    maxSources: 6,
    minSimilarity: 0.6,
    showReasoning: false,
    showSources: true,
    reasoningEffort: 'off',
    memorySummaryThresholdRatio: 0.5,
    memoryRecentTurnCount: 6,
    maxMessageChars: 700,
    maxTurnsPerConversation: 200,
    version,
    isActive: false,
    createdByAdminUserId: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    note: null,
    ...overrides,
  };
}

describe('settingsVersionPlacard', () => {
  it('marks the active version and voids the others without hiding them', () => {
    expect(settingsVersionPlacard({ isActive: true })).toEqual({ state: 'ready', label: 'Active' });
    expect(settingsVersionPlacard({ isActive: false })).toEqual({ state: 'stopped', label: 'Superseded' });
  });
});

describe('settingsVersionAuthor', () => {
  it('shortens the admin id and names saves without one', () => {
    expect(settingsVersionAuthor({ createdByAdminUserId: '1234abcd-0000-4000-8000-000000000000' })).toBe(
      'Admin 1234abcd',
    );
    expect(settingsVersionAuthor({ createdByAdminUserId: null })).toBe('Seed or API key');
  });
});

describe('changesFromPreviousVersion', () => {
  it('compares each version with the one saved before it', () => {
    const versions = [aVersion(3, { showSources: false, isActive: true }), aVersion(2, { maxSources: 8 }), aVersion(1)];
    const changesByVersion = changesFromPreviousVersion(versions);
    expect(changesByVersion.get(3)?.map((change) => change.settingName)).toEqual(['showSources', 'maxSources']);
    expect(changesByVersion.get(2)?.map((change) => change.settingName)).toEqual(['maxSources']);
    expect(changesByVersion.get(1)).toBeNull();
  });
});
