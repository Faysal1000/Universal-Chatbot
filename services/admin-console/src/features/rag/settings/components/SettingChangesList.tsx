import type { SettingChange } from '../chatbotSettingsFormModel';

/** Each changed setting with its value before and after, struck-through old value first. */
export function SettingChangesList({ changes }: { changes: readonly SettingChange[] }) {
  return (
    <dl className="flex flex-col divide-y divide-border rounded border border-border text-sm">
      {changes.map((change) => (
        <div key={change.settingName} className="grid gap-1 px-3 py-2 sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium text-primary">{change.label}</dt>
          <dd className="flex min-w-0 flex-col gap-0.5">
            <span className="line-clamp-3 break-words text-muted line-through">
              <span className="sr-only">Before: </span>
              {change.before}
            </span>
            <span className="line-clamp-3 break-words text-primary">
              <span className="sr-only">After: </span>
              {change.after}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
