import type { ReactNode } from 'react';

import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { HintButton, TextAreaField, TextField } from '@/shared/ui/FormFields';
import { useHint } from '@/shared/ui/useHint';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import { NUMERIC_SETTING_LIMITS, SETTING_LABELS, TEXT_SETTING_LIMITS } from '../chatbotSettingsFormModel';
import type { ChatbotSettingsFormValues } from '../chatbotSettingsFormModel';
import { SETTING_HELP_TEXTS } from '../settingHelpTexts';

type FormValueChange = (changes: Partial<ChatbotSettingsFormValues>) => void;

interface SettingFieldProps<SettingName> {
  name: SettingName;
  values: ChatbotSettingsFormValues;
  fieldErrors: FieldErrorMessages;
  onChange: FormValueChange;
}

/** A group of related settings under one heading. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-sm font-semibold text-primary">{title}</legend>
      {children}
    </fieldset>
  );
}

type TextSettingName = keyof typeof TEXT_SETTING_LIMITS;

export function TextSettingField({
  name,
  values,
  fieldErrors,
  onChange,
  isMultiline = false,
}: SettingFieldProps<TextSettingName> & { isMultiline?: boolean }) {
  const sharedProps = {
    label: SETTING_LABELS[name],
    helpText: SETTING_HELP_TEXTS[name],
    errorMessage: fieldErrors[name],
    value: values[name],
    maxLength: TEXT_SETTING_LIMITS[name].maximumLength,
  };
  return isMultiline ? (
    <TextAreaField
      {...sharedProps}
      rows={name === 'systemInstruction' ? 8 : 3}
      onChange={(changeEvent) => onChange({ [name]: changeEvent.target.value })}
    />
  ) : (
    <TextField {...sharedProps} onChange={(changeEvent) => onChange({ [name]: changeEvent.target.value })} />
  );
}

type NumericSettingName = keyof typeof NUMERIC_SETTING_LIMITS;

export function NumericSettingField({ name, values, fieldErrors, onChange }: SettingFieldProps<NumericSettingName>) {
  const limits = NUMERIC_SETTING_LIMITS[name];
  return (
    <TextField
      label={SETTING_LABELS[name]}
      helpText={SETTING_HELP_TEXTS[name]}
      errorMessage={fieldErrors[name]}
      type="number"
      inputMode={limits.isInteger ? 'numeric' : 'decimal'}
      min={limits.minimum}
      max={limits.maximum}
      step={limits.isInteger ? 1 : 0.01}
      className="max-w-xs"
      value={values[name]}
      onChange={(changeEvent) => onChange({ [name]: changeEvent.target.value })}
    />
  );
}

export function SettingSwitch({
  name,
  values,
  onChange,
}: Omit<SettingFieldProps<'answerOnlyFromDocuments' | 'showReasoning' | 'showSources'>, 'fieldErrors'>) {
  const hint = useHint();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <ToggleSwitch
          isOn={values[name]}
          onChange={(isOn) => onChange({ [name]: isOn })}
          label={SETTING_LABELS[name]}
          describedBy={hint.id}
        />
        <HintButton {...hint.buttonProps} />
      </div>
      <p id={hint.id} className={hint.textClassName}>
        {SETTING_HELP_TEXTS[name]}
      </p>
    </div>
  );
}
