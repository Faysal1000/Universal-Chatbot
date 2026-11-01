import { SegmentedControl } from '@/shared/ui/SegmentedControl';

import { OVERVIEW_WINDOW_DAYS } from './api/overviewTypes';
import type { OverviewWindowDays } from './api/overviewTypes';

const WINDOW_OPTIONS = OVERVIEW_WINDOW_DAYS.map((days) => ({ value: String(days), label: `${days}D` }));

export function WindowDaysSelector({
  selectedDays,
  onChange,
}: {
  selectedDays: OverviewWindowDays;
  onChange: (days: OverviewWindowDays) => void;
}) {
  return (
    <SegmentedControl
      label="Window"
      options={WINDOW_OPTIONS}
      value={String(selectedDays)}
      onChange={(value) => {
        const days = OVERVIEW_WINDOW_DAYS.find((candidate) => String(candidate) === value);
        if (days !== undefined) onChange(days);
      }}
    />
  );
}
