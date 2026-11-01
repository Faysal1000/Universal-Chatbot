import { Button } from '@/shared/ui/Button';
import { HintButton } from '@/shared/ui/FormFields';
import { useHint } from '@/shared/ui/useHint';

import type { ExtraHeaderRow } from '../providerFormModel';
import { createExtraHeaderRow } from '../providerFormModel';

export interface ExtraHeadersEditorProps {
  rows: readonly ExtraHeaderRow[];
  onChange: (rows: ExtraHeaderRow[]) => void;
  errorMessage?: string | undefined;
}

/** Key/value editor; stored header values are never shown and stay unchanged when left empty. */
export function ExtraHeadersEditor({ rows, onChange, errorMessage }: ExtraHeadersEditorProps) {
  const hint = useHint();
  const updateRow = (rowId: number, changes: Partial<ExtraHeaderRow>) =>
    onChange(rows.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)));

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={hint.id}>
      <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium text-primary">
        Extra headers
        <HintButton {...hint.buttonProps} />
      </legend>
      <p id={hint.id} className={hint.textClassName}>
        Sent with every request to this provider. Saved values are hidden; leave a value empty to keep it.
      </p>
      {rows.map((row, rowIndex) => (
        <div key={row.rowId} className="flex items-center gap-2">
          <input
            aria-label={`Header ${rowIndex + 1} name`}
            placeholder="Header name"
            value={row.name}
            readOnly={row.isStored}
            onChange={(changeEvent) => updateRow(row.rowId, { name: changeEvent.target.value })}
            className="h-9 w-2/5 rounded border border-border bg-surface-input px-3 font-mono text-sm text-primary placeholder:text-muted read-only:text-secondary"
          />
          <input
            aria-label={`Header ${rowIndex + 1} value`}
            type="password"
            autoComplete="off"
            placeholder={row.isStored ? '•••••••• (saved, leave empty to keep)' : 'Value'}
            value={row.value}
            onChange={(changeEvent) => updateRow(row.rowId, { value: changeEvent.target.value })}
            className="h-9 flex-1 rounded border border-border bg-surface-input px-3 text-sm text-primary placeholder:text-muted"
          />
          <Button
            variant="ghost"
            size="small"
            aria-label={`Remove header ${row.name || rowIndex + 1}`}
            onClick={() => onChange(rows.filter((candidate) => candidate.rowId !== row.rowId))}
          >
            Remove
          </Button>
        </div>
      ))}
      {errorMessage ? (
        <p className="text-xs text-critical-text" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div>
        <Button size="small" onClick={() => onChange([...rows, createExtraHeaderRow()])}>
          Add header
        </Button>
      </div>
    </fieldset>
  );
}
