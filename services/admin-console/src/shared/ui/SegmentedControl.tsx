import { useId } from 'react';

import { joinClassNames } from '../lib/classNames';
import { segmentClassName } from './segmentClassName';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
}

/** A small radio group drawn as joined buttons (time ranges, views). Arrow keys move between options; the label is for screen readers. */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const name = useId();
  return (
    <fieldset className="inline-flex items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="inline-flex rounded border border-border bg-surface">
        {options.map((option) => (
          <label
            key={option.value}
            className={joinClassNames(
              'cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
              segmentClassName(option.value === value),
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
