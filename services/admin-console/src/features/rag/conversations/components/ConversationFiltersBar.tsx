import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/FormFields';

import type { ConversationFilters } from '../api/conversationTypes';
import {
  MAXIMUM_SEARCH_TEXT_LENGTH,
  hasActiveConversationFilters,
  validateConversationFilters,
} from '../conversationFilters';

export interface ConversationFiltersBarProps {
  appliedFilters: ConversationFilters;
  onApply: (filters: ConversationFilters) => void;
}

/** Filters apply on submit, so typing does not fire a search per keystroke. */
export function ConversationFiltersBar({ appliedFilters, onApply }: ConversationFiltersBarProps) {
  const [draftFilters, setDraftFilters] = useState<ConversationFilters>(appliedFilters);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateConversationFilters>>({});

  const applyFilters = (submitEvent: SubmitEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const validationErrors = validateConversationFilters(draftFilters);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) onApply(draftFilters);
  };

  const clearFilters = () => {
    const emptyFilters = { searchText: '', visitorSessionId: '' };
    setDraftFilters(emptyFilters);
    setFieldErrors({});
    onApply(emptyFilters);
  };

  return (
    <form onSubmit={applyFilters} noValidate className="mb-5 flex flex-wrap items-start gap-3">
      <TextField
        label="Search"
        className="w-72"
        type="search"
        value={draftFilters.searchText}
        maxLength={MAXIMUM_SEARCH_TEXT_LENGTH}
        placeholder="Words in the title or any message"
        onChange={(changeEvent) => setDraftFilters((current) => ({ ...current, searchText: changeEvent.target.value }))}
        errorMessage={fieldErrors.searchText}
      />
      <TextField
        label="Visitor session"
        className="w-80"
        value={draftFilters.visitorSessionId}
        placeholder="Session id (UUID)"
        spellCheck={false}
        autoComplete="off"
        onChange={(changeEvent) =>
          setDraftFilters((current) => ({ ...current, visitorSessionId: changeEvent.target.value }))
        }
        errorMessage={fieldErrors.visitorSessionId}
      />
      <div className="flex gap-2 pt-7">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        {hasActiveConversationFilters(appliedFilters) ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </form>
  );
}
