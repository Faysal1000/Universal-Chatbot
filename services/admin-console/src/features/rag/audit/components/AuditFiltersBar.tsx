import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Button } from '@/shared/ui/Button';
import { SelectField, TextField } from '@/shared/ui/FormFields';

import type { AuditEventFilters } from '../api/auditTypes';
import {
  EMPTY_AUDIT_FILTERS,
  KNOWN_AUDIT_ACTIONS,
  KNOWN_AUDIT_TARGET_TYPES,
  describeAuditAction,
  describeTargetType,
  hasActiveAuditFilters,
} from '../auditModel';

const ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  ...KNOWN_AUDIT_ACTIONS.map((action) => ({ value: action, label: describeAuditAction(action) })),
];

const TARGET_TYPE_OPTIONS = [
  { value: '', label: 'Any target' },
  ...KNOWN_AUDIT_TARGET_TYPES.map((targetType) => ({ value: targetType, label: describeTargetType(targetType) })),
];

export function AuditFiltersBar({
  appliedFilters,
  onApply,
}: {
  appliedFilters: AuditEventFilters;
  onApply: (filters: AuditEventFilters) => void;
}) {
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const updateDraft = (changes: Partial<AuditEventFilters>) =>
    setDraftFilters((current) => ({ ...current, ...changes }));

  const applyFilters = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    onApply({ ...draftFilters, targetId: draftFilters.targetId.trim() });
  };

  return (
    <form onSubmit={applyFilters} className="mb-5 flex flex-wrap items-end gap-3">
      <SelectField
        label="Action"
        className="w-56"
        value={draftFilters.action}
        options={ACTION_OPTIONS}
        onChange={(changeEvent) => updateDraft({ action: changeEvent.target.value })}
      />
      <SelectField
        label="Target type"
        className="w-48"
        value={draftFilters.targetType}
        options={TARGET_TYPE_OPTIONS}
        onChange={(changeEvent) => updateDraft({ targetType: changeEvent.target.value })}
      />
      <TextField
        label="Target id"
        className="w-80"
        value={draftFilters.targetId}
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        placeholder="e.g. a document id"
        onChange={(changeEvent) => updateDraft({ targetId: changeEvent.target.value })}
      />
      <Button type="submit" variant="primary">
        Apply filters
      </Button>
      {hasActiveAuditFilters(appliedFilters) ? (
        <Button
          variant="ghost"
          onClick={() => {
            setDraftFilters(EMPTY_AUDIT_FILTERS);
            onApply(EMPTY_AUDIT_FILTERS);
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </form>
  );
}
