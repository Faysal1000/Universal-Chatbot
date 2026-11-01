import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { useToast } from '@/shared/ui/toastContext';

import { useSaveChatbotSettings } from '../api/chatbotSettingsQueries';
import { REASONING_EFFORTS } from '../api/chatbotSettingsTypes';
import type { ChatbotSettingsVersion, ReasoningEffort } from '../api/chatbotSettingsTypes';
import {
  formValuesFromSettings,
  listSettingChanges,
  MAXIMUM_VERSION_NOTE_LENGTH,
  SETTING_LABELS,
  settingsOfVersion,
  toSaveRequest,
  toSettings,
  validateSettingsForm,
} from '../chatbotSettingsFormModel';
import type { ChatbotSettingsFormValues, SettingChange } from '../chatbotSettingsFormModel';
import { SETTING_HELP_TEXTS } from '../settingHelpTexts';
import { SettingChangesList } from './SettingChangesList';
import { NumericSettingField, SettingSwitch, SettingsSection, TextSettingField } from './SettingFields';
import { SuggestedPromptsEditor } from './SuggestedPromptsEditor';

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
const REASONING_EFFORT_OPTIONS = REASONING_EFFORTS.map((effort) => ({
  value: effort,
  label: REASONING_EFFORT_LABELS[effort],
}));

/**
 * Edits the active version. Changes are listed as they are made; "Save settings" stores them
 * as a new active version. Remount it (key = version) to start over from another version.
 */
export function ChatbotSettingsForm({ activeSettings }: { activeSettings: ChatbotSettingsVersion }) {
  const [values, setValues] = useState<ChatbotSettingsFormValues>(() => formValuesFromSettings(activeSettings));
  const [versionNote, setVersionNote] = useState('');
  const saveMutation = useSaveChatbotSettings();
  const { showToast } = useToast();

  const fieldErrors = validateSettingsForm(values);
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const settingChanges = hasErrors ? [] : pendingChanges(activeSettings, values);
  const change = (changes: Partial<ChatbotSettingsFormValues>) => setValues((current) => ({ ...current, ...changes }));

  const save = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (hasErrors || settingChanges.length === 0) return;
    saveMutation.mutate(toSaveRequest(values, versionNote), {
      onSuccess: (savedSettings) => showToast(`Saved version ${savedSettings.version} (active).`, 'success'),
    });
  };

  const fieldProps = { values, fieldErrors, onChange: change };
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-6">
      <SettingsSection title="Identity and greeting">
        <TextSettingField name="botName" {...fieldProps} />
        <TextSettingField name="greetingMessage" isMultiline {...fieldProps} />
        <SuggestedPromptsEditor
          prompts={values.suggestedPrompts}
          errorMessage={fieldErrors.suggestedPrompts}
          onChange={(suggestedPrompts) => change({ suggestedPrompts })}
        />
      </SettingsSection>
      <SettingsSection title="Answer behaviour">
        <TextSettingField name="systemInstruction" isMultiline {...fieldProps} />
        <TextSettingField name="fallbackMessage" isMultiline {...fieldProps} />
        <SettingSwitch name="answerOnlyFromDocuments" values={values} onChange={change} />
        <div className="grid gap-4 md:grid-cols-3">
          <NumericSettingField name="answerTemperature" {...fieldProps} />
          <NumericSettingField name="maxAnswerTokens" {...fieldProps} />
          <SelectField
            label={SETTING_LABELS.reasoningEffort}
            helpText={SETTING_HELP_TEXTS.reasoningEffort}
            options={REASONING_EFFORT_OPTIONS}
            value={values.reasoningEffort}
            onChange={(changeEvent) => change({ reasoningEffort: changeEvent.target.value as ReasoningEffort })}
          />
        </div>
        <SettingSwitch name="showReasoning" values={values} onChange={change} />
        <SettingSwitch name="showSources" values={values} onChange={change} />
      </SettingsSection>
      <SettingsSection title="Retrieval">
        <div className="grid gap-4 md:grid-cols-2">
          <NumericSettingField name="minSimilarity" {...fieldProps} />
          <NumericSettingField name="maxSources" {...fieldProps} />
        </div>
      </SettingsSection>
      <SettingsSection title="Conversation memory">
        <div className="grid gap-4 md:grid-cols-2">
          <NumericSettingField name="memorySummaryThresholdRatio" {...fieldProps} />
          <NumericSettingField name="memoryRecentTurnCount" {...fieldProps} />
        </div>
      </SettingsSection>
      <SettingsSection title="Visitor limits">
        <div className="grid gap-4 md:grid-cols-2">
          <NumericSettingField name="maxMessageChars" {...fieldProps} />
          <NumericSettingField name="maxTurnsPerConversation" {...fieldProps} />
        </div>
      </SettingsSection>
      <SaveBar
        activeVersion={activeSettings.version}
        changes={settingChanges}
        hasErrors={hasErrors}
        isSaving={saveMutation.isPending}
        versionNote={versionNote}
        onVersionNoteChange={setVersionNote}
        saveErrorMessage={saveMutation.isError ? describeError(saveMutation.error) : null}
        onDiscard={() => {
          setValues(formValuesFromSettings(activeSettings));
          setVersionNote('');
          saveMutation.reset();
        }}
      />
    </form>
  );
}

function pendingChanges(activeSettings: ChatbotSettingsVersion, values: ChatbotSettingsFormValues): SettingChange[] {
  return listSettingChanges(settingsOfVersion(activeSettings), toSettings(values));
}

interface SaveBarProps {
  activeVersion: number;
  changes: readonly SettingChange[];
  hasErrors: boolean;
  isSaving: boolean;
  versionNote: string;
  onVersionNoteChange: (versionNote: string) => void;
  saveErrorMessage: string | null;
  onDiscard: () => void;
}

function SaveBar({
  activeVersion,
  changes,
  hasErrors,
  isSaving,
  versionNote,
  onVersionNoteChange,
  saveErrorMessage,
  onDiscard,
}: SaveBarProps) {
  const hasChanges = changes.length > 0;
  return (
    <section aria-label="Review changes" className="flex flex-col gap-3 border-t border-border pt-4">
      <div aria-live="polite">
        {hasErrors ? (
          <p className="text-sm text-critical-text">Fix the fields marked above to see what will change.</p>
        ) : hasChanges ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-secondary">
              Saving creates a new version with {changes.length} {changes.length === 1 ? 'change' : 'changes'} and makes
              it active. Version {activeVersion} stays in the history and can be activated again.
            </p>
            <SettingChangesList changes={changes} />
          </div>
        ) : (
          <p className="text-sm text-muted">No changes from version {activeVersion}.</p>
        )}
      </div>
      {hasChanges ? (
        <TextField
          className="max-w-2xl"
          label="Note for this version"
          value={versionNote}
          maxLength={MAXIMUM_VERSION_NOTE_LENGTH}
          placeholder="Optional: why you changed these settings"
          onChange={(changeEvent) => onVersionNoteChange(changeEvent.target.value)}
        />
      ) : null}
      {saveErrorMessage ? <ErrorBanner title="Settings not saved" message={saveErrorMessage} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" isLoading={isSaving} disabled={isSaving || !hasChanges}>
          Save settings
        </Button>
        <Button disabled={!hasChanges && !hasErrors} onClick={onDiscard}>
          Discard changes
        </Button>
      </div>
    </section>
  );
}
