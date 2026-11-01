import { joinClassNames } from '../lib/classNames';

/** One joined segment; shared by SegmentedControl and the toggle-button strips that open editors. */
export function segmentClassName(isSelected: boolean): string {
  return joinClassNames(
    'border-r border-border px-2.5 py-1 text-xs last:border-r-0 pointer-coarse:py-2.5',
    isSelected ? 'bg-surface-selected font-semibold text-primary' : 'text-secondary hover:bg-surface-hover',
  );
}
