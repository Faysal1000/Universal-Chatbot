import { joinClassNames } from '../lib/classNames';

export interface ToggleSwitchProps {
  isOn: boolean;
  onChange: (nextIsOn: boolean) => void;
  /** Accessible name; shown next to the switch unless `isLabelVisuallyHidden`. */
  label: string;
  isLabelVisuallyHidden?: boolean;
  disabled?: boolean;
  /** Id of an element describing the switch. */
  describedBy?: string;
}

export function ToggleSwitch({
  isOn,
  onChange,
  label,
  isLabelVisuallyHidden = false,
  disabled = false,
  describedBy,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={isLabelVisuallyHidden ? label : undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!isOn)}
      className="group inline-flex items-center gap-2.5 rounded-full text-sm text-primary disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
    >
      <span
        aria-hidden="true"
        className={joinClassNames(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
          isOn ? 'border-primary bg-primary' : 'border-border-strong bg-surface-input',
        )}
      >
        <span
          className={joinClassNames(
            'inline-block size-3.5 rounded-full transition-transform',
            isOn ? 'translate-x-[18px] bg-surface' : 'translate-x-[2px] bg-border-strong',
          )}
        />
      </span>
      {isLabelVisuallyHidden ? null : <span>{label}</span>}
    </button>
  );
}
