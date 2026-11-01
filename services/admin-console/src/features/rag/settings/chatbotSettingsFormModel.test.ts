import { describe, expect, it } from 'vitest';

import type { ChatbotSettings, ChatbotSettingsVersion } from './api/chatbotSettingsTypes';
import {
  formValuesFromSettings,
  listSettingChanges,
  settingsOfVersion,
  toSaveRequest,
  toSettings,
  validateSettingsForm,
} from './chatbotSettingsFormModel';
import type { ChatbotSettingsFormValues } from './chatbotSettingsFormModel';

function someEditableSettings(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    botName: 'Nodi',
    greetingMessage: 'Hello! Ask me about the handbook.',
    suggestedPrompts: ['How many leave days do I have?'],
    systemInstruction: 'Answer briefly and politely.',
    fallbackMessage: 'I could not find that in the documents.',
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
    ...overrides,
  };
}

function aSettingsVersion(editableOverrides: Partial<ChatbotSettings> = {}): ChatbotSettingsVersion {
  return {
    ...someEditableSettings(editableOverrides),
    version: 3,
    isActive: true,
    createdByAdminUserId: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    note: null,
  };
}

function aFormFrom(overrides: Partial<ChatbotSettingsFormValues> = {}): ChatbotSettingsFormValues {
  return { ...formValuesFromSettings(aSettingsVersion()), ...overrides };
}

describe('load → form → request body', () => {
  it('round-trips every editable field, including showSources', () => {
    const changedFields = { showSources: false, showReasoning: true, reasoningEffort: 'medium' } as const;
    const loadedVersion = aSettingsVersion(changedFields);
    expect(toSettings(formValuesFromSettings(loadedVersion))).toEqual(someEditableSettings(changedFields));
  });

  it('keeps numbers as text while editing', () => {
    expect(aFormFrom().minSimilarity).toBe('0.6');
    expect(aFormFrom().maxTurnsPerConversation).toBe('200');
  });

  it('adds the version note to the save request, blank as null', () => {
    expect(toSaveRequest(aFormFrom(), '  Lower temperature for policy answers  ').note).toBe(
      'Lower temperature for policy answers',
    );
    expect(toSaveRequest(aFormFrom(), '   ').note).toBeNull();
  });

  it('trims text and drops empty prompt rows', () => {
    const request = toSettings(aFormFrom({ botName: '  Nodi  ', suggestedPrompts: [' First ', '', '  '] }));
    expect(request.botName).toBe('Nodi');
    expect(request.suggestedPrompts).toEqual(['First']);
  });
});

describe('validateSettingsForm', () => {
  it('accepts the loaded settings', () => {
    expect(validateSettingsForm(aFormFrom())).toEqual({});
  });

  it('requires text fields', () => {
    expect(validateSettingsForm(aFormFrom({ botName: '   ' })).botName).toBe('Required.');
  });

  it('enforces text lengths', () => {
    expect(validateSettingsForm(aFormFrom({ botName: 'x'.repeat(81) })).botName).toMatch(/At most 80 characters/);
  });

  it.each<[keyof ChatbotSettingsFormValues, string]>([
    ['minSimilarity', '1.2'],
    ['answerTemperature', '-0.1'],
    ['maxAnswerTokens', '32'],
    ['maxSources', '21'],
    ['memorySummaryThresholdRatio', '0.05'],
    ['memoryRecentTurnCount', '0'],
    ['maxMessageChars', '49'],
    ['maxTurnsPerConversation', '10001'],
  ])('refuses %s = %s (outside rag’s range)', (settingName, value) => {
    expect(validateSettingsForm(aFormFrom({ [settingName]: value }))[settingName]).toMatch(/from/);
  });

  it('requires whole numbers where rag does', () => {
    expect(validateSettingsForm(aFormFrom({ maxSources: '2.5' })).maxSources).toMatch(/whole number/);
  });

  it('refuses an empty or non-numeric number', () => {
    expect(validateSettingsForm(aFormFrom({ minSimilarity: '' })).minSimilarity).toMatch(/Enter a number/);
    expect(validateSettingsForm(aFormFrom({ minSimilarity: 'abc' })).minSimilarity).toMatch(/Enter a number/);
  });

  it('limits suggested prompts to 6 of at most 200 characters', () => {
    expect(
      validateSettingsForm(aFormFrom({ suggestedPrompts: Array.from({ length: 7 }, () => 'Q') })).suggestedPrompts,
    ).toBe('At most 6 prompts.');
    expect(validateSettingsForm(aFormFrom({ suggestedPrompts: ['x'.repeat(201)] })).suggestedPrompts).toMatch(/200/);
  });
});

describe('listSettingChanges', () => {
  it('lists nothing when nothing changed', () => {
    const settings = settingsOfVersion(aSettingsVersion());
    expect(listSettingChanges(settings, toSettings(aFormFrom()))).toEqual([]);
  });

  it('lists each changed field with readable before and after values, in form order', () => {
    const current = settingsOfVersion(aSettingsVersion());
    const proposed = toSettings(aFormFrom({ showSources: false, minSimilarity: '0.65', suggestedPrompts: ['A', 'B'] }));
    expect(listSettingChanges(current, proposed)).toEqual([
      {
        settingName: 'suggestedPrompts',
        label: 'Suggested prompts',
        before: '“How many leave days do I have?”',
        after: '“A”, “B”',
      },
      { settingName: 'showSources', label: 'Show sources', before: 'On', after: 'Off' },
      { settingName: 'minSimilarity', label: 'Minimum similarity', before: '0.6', after: '0.65' },
    ]);
  });

  it('shows an emptied prompt list as None', () => {
    const proposed = toSettings(aFormFrom({ suggestedPrompts: [] }));
    expect(listSettingChanges(settingsOfVersion(aSettingsVersion()), proposed)[0]?.after).toBe('None');
  });
});
