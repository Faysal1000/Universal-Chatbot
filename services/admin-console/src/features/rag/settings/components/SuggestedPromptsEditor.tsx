import { Plus, X } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/shared/ui/Button';
import { HintButton } from '@/shared/ui/FormFields';
import { useHint } from '@/shared/ui/useHint';

import {
  MAXIMUM_SUGGESTED_PROMPT_LENGTH,
  MAXIMUM_SUGGESTED_PROMPTS,
  SETTING_LABELS,
} from '../chatbotSettingsFormModel';
import { SETTING_HELP_TEXTS } from '../settingHelpTexts';

export interface SuggestedPromptsEditorProps {
  prompts: readonly string[];
  errorMessage: string | undefined;
  onChange: (prompts: string[]) => void;
}

/** One text input per starter question, with add and remove. */
export function SuggestedPromptsEditor({ prompts, errorMessage, onChange }: SuggestedPromptsEditorProps) {
  const groupId = useId();
  const hint = useHint();

  const replacePrompt = (index: number, prompt: string) =>
    onChange(prompts.map((existingPrompt, existingIndex) => (existingIndex === index ? prompt : existingPrompt)));
  const removePrompt = (index: number) => onChange(prompts.filter((_prompt, existingIndex) => existingIndex !== index));

  return (
    <div role="group" aria-labelledby={groupId} aria-describedby={hint.id} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span id={groupId} className="text-sm font-medium text-primary">
          {SETTING_LABELS.suggestedPrompts}
        </span>
        <HintButton {...hint.buttonProps} />
      </div>
      <ol className="flex flex-col gap-2">
        {prompts.map((prompt, index) => (
          // Prompts have no identity of their own; their position is what the admin edits.
          <li key={index} className="flex items-center gap-2">
            <input
              aria-label={`Suggested prompt ${index + 1}`}
              value={prompt}
              maxLength={MAXIMUM_SUGGESTED_PROMPT_LENGTH}
              onChange={(changeEvent) => replacePrompt(index, changeEvent.target.value)}
              className="h-9 w-full rounded border border-border-strong bg-surface-input px-3 text-sm text-primary hover:border-primary/50 focus:border-accent focus:outline-none focus-visible:outline-2"
            />
            <Button
              size="small"
              variant="ghost"
              aria-label={`Remove suggested prompt ${index + 1}`}
              leadingIcon={<X aria-hidden="true" className="size-4" />}
              onClick={() => removePrompt(index)}
            />
          </li>
        ))}
      </ol>
      {prompts.length < MAXIMUM_SUGGESTED_PROMPTS ? (
        <Button
          size="small"
          className="self-start"
          leadingIcon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => onChange([...prompts, ''])}
        >
          Add prompt
        </Button>
      ) : null}
      {errorMessage ? (
        <p className="text-xs text-critical-text" role="alert">
          {errorMessage}
        </p>
      ) : (
        <p id={hint.id} className={hint.textClassName}>
          {SETTING_HELP_TEXTS.suggestedPrompts}
        </p>
      )}
    </div>
  );
}
