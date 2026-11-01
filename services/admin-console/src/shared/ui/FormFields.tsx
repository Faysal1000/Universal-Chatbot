import { Info } from 'lucide-react';
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { joinClassNames } from '../lib/classNames';
import { hintClassName, useHint } from './useHint';

const controlClassName = joinClassNames(
  'w-full rounded border border-border-strong bg-surface-input px-3 text-sm text-primary placeholder:text-muted',
  'transition-colors hover:border-primary/50 focus:border-accent focus:outline-none focus-visible:outline-2',
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-critical',
);

interface FieldChromeProps {
  label: ReactNode;
  helpText?: ReactNode;
  errorMessage?: string | undefined;
  isLabelVisuallyHidden?: boolean;
  className?: string;
}

interface FieldFrameProps extends FieldChromeProps {
  controlId: string;
  helpTextId: string;
  errorMessageId: string;
  children: ReactNode;
}

/** The ⓘ next to a label that shows or hides the hint with id `hintId`. */
export function HintButton({
  isHintShown,
  onToggle,
  hintId,
}: {
  isHintShown: boolean;
  onToggle: (isHintShown: boolean) => void;
  hintId: string;
}) {
  return (
    <button
      type="button"
      aria-label={isHintShown ? 'Hide hint' : 'Show hint'}
      aria-expanded={isHintShown}
      aria-controls={hintId}
      onClick={() => onToggle(!isHintShown)}
      className="inline-flex size-5 items-center justify-center rounded-sm text-muted hover:text-primary pointer-coarse:size-8"
    >
      <Info aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function FieldFrame({
  label,
  helpText,
  errorMessage,
  isLabelVisuallyHidden,
  className,
  controlId,
  helpTextId,
  errorMessageId,
  children,
}: FieldFrameProps) {
  const hint = useHint(helpTextId);
  const hasVisibleHintToggle = Boolean(helpText) && !isLabelVisuallyHidden;
  return (
    <div className={joinClassNames('flex flex-col gap-1.5', className)}>
      <div className={isLabelVisuallyHidden ? 'sr-only' : 'flex items-center gap-1'}>
        <label htmlFor={controlId} className="text-sm font-medium text-primary">
          {label}
        </label>
        {hasVisibleHintToggle ? <HintButton {...hint.buttonProps} /> : null}
      </div>
      {children}
      {helpText && !errorMessage ? (
        <p id={helpTextId} className={hintClassName(hint.isHintShown || !hasVisibleHintToggle)}>
          {helpText}
        </p>
      ) : null}
      {errorMessage ? (
        <p id={errorMessageId} className="text-xs text-critical-text" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function useFieldIds(explicitId: string | undefined) {
  const generatedId = useId();
  const controlId = explicitId ?? generatedId;
  return { controlId, helpTextId: `${controlId}-help`, errorMessageId: `${controlId}-error` };
}

function describedBy(ids: ReturnType<typeof useFieldIds>, chrome: FieldChromeProps): string | undefined {
  if (chrome.errorMessage) return ids.errorMessageId;
  return chrome.helpText ? ids.helpTextId : undefined;
}

export type TextFieldProps = FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function TextField({
  label,
  helpText,
  errorMessage,
  isLabelVisuallyHidden,
  className,
  id,
  ...inputAttributes
}: TextFieldProps) {
  const fieldIds = useFieldIds(id);
  const chrome = { label, helpText, errorMessage, isLabelVisuallyHidden, className };
  return (
    <FieldFrame {...chrome} {...fieldIds}>
      <input
        id={fieldIds.controlId}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy(fieldIds, chrome)}
        className={joinClassNames(controlClassName, 'h-9')}
        {...inputAttributes}
      />
    </FieldFrame>
  );
}

export type TextAreaFieldProps = FieldChromeProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export function TextAreaField({
  label,
  helpText,
  errorMessage,
  isLabelVisuallyHidden,
  className,
  id,
  ...textAreaAttributes
}: TextAreaFieldProps) {
  const fieldIds = useFieldIds(id);
  const chrome = { label, helpText, errorMessage, isLabelVisuallyHidden, className };
  return (
    <FieldFrame {...chrome} {...fieldIds}>
      <textarea
        id={fieldIds.controlId}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy(fieldIds, chrome)}
        className={joinClassNames(controlClassName, 'min-h-20 py-2')}
        {...textAreaAttributes}
      />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = FieldChromeProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { options: readonly SelectOption[] };

export function SelectField({
  label,
  helpText,
  errorMessage,
  isLabelVisuallyHidden,
  className,
  id,
  options,
  ...selectAttributes
}: SelectFieldProps) {
  const fieldIds = useFieldIds(id);
  const chrome = { label, helpText, errorMessage, isLabelVisuallyHidden, className };
  return (
    <FieldFrame {...chrome} {...fieldIds}>
      <select
        id={fieldIds.controlId}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy(fieldIds, chrome)}
        className={joinClassNames(controlClassName, 'select-chevron h-9 appearance-none pr-8')}
        {...selectAttributes}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
