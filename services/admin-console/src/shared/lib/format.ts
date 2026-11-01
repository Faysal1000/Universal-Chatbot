/**
 * Display formatting for numbers, durations and dates.
 * Every formatter renders `null`/`undefined` as an em dash so tables never show "null".
 */

export const MISSING_VALUE_PLACEHOLDER = '—';

type MaybeNumber = number | null | undefined;

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function isMissing(value: MaybeNumber): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value);
}

/** 1234567 → "1,234,567". */
export function formatInteger(value: MaybeNumber): string {
  return isMissing(value) ? MISSING_VALUE_PLACEHOLDER : integerFormatter.format(value);
}

/** 1234 → "1.2K", 12_900_000 → "12.9M"; values below 1,000 keep their exact form. */
export function formatCompactNumber(value: MaybeNumber): string {
  if (isMissing(value)) return MISSING_VALUE_PLACEHOLDER;
  return Math.abs(value) < 1000 ? integerFormatter.format(value) : compactFormatter.format(value);
}

/** A 0–1 fraction as a percentage: 0.0042 → "0.42%", 0 → "0%". */
export function formatPercentFromFraction(fraction: MaybeNumber): string {
  if (isMissing(fraction)) return MISSING_VALUE_PLACEHOLDER;
  const percentage = fraction * 100;
  if (percentage === 0) return '0%';
  if (Math.abs(percentage) < 0.01) return '<0.01%';
  const fractionDigits = Math.abs(percentage) < 10 ? 2 : 1;
  return `${percentage.toFixed(fractionDigits)}%`;
}

/** Milliseconds as "840 ms", "1.24 s", "12.5 s" or "2m 05s". */
export function formatDurationMilliseconds(milliseconds: MaybeNumber): string {
  if (isMissing(milliseconds)) return MISSING_VALUE_PLACEHOLDER;
  if (Math.abs(milliseconds) < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - wholeMinutes * 60);
  return `${wholeMinutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

/** Output throughput: "84.2 tok/s". */
export function formatTokensPerSecond(tokensPerSecond: MaybeNumber): string {
  if (isMissing(tokensPerSecond)) return MISSING_VALUE_PLACEHOLDER;
  return `${tokensPerSecond >= 100 ? Math.round(tokensPerSecond).toString() : tokensPerSecond.toFixed(1)} tok/s`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Storage size with binary steps: 512 → "512 B", 1536 → "1.5 KB", 3_145_728 → "3 MB". */
export function formatBytes(byteCount: MaybeNumber): string {
  if (isMissing(byteCount)) return MISSING_VALUE_PLACEHOLDER;
  let scaledValue = byteCount;
  let unitIndex = 0;
  while (Math.abs(scaledValue) >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaledValue /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = unitIndex === 0 || scaledValue >= 100 ? 0 : 1;
  return `${Number(scaledValue.toFixed(fractionDigits)).toString()} ${BYTE_UNITS[unitIndex] ?? 'B'}`;
}

const SECONDS_PER_UNIT = [
  ['d', 86_400],
  ['h', 3_600],
  ['m', 60],
  ['s', 1],
] as const;

/** Whole seconds as the two largest units: 3600 → "1h", 5400 → "1h 30m", 90 → "1m 30s". */
export function formatSecondsAsDuration(totalSeconds: MaybeNumber): string {
  if (isMissing(totalSeconds)) return MISSING_VALUE_PLACEHOLDER;
  let remainingSeconds = Math.round(totalSeconds);
  const parts: string[] = [];
  for (const [unitSymbol, unitSeconds] of SECONDS_PER_UNIT) {
    const unitCount = Math.floor(remainingSeconds / unitSeconds);
    remainingSeconds -= unitCount * unitSeconds;
    if (unitCount > 0) parts.push(`${unitCount}${unitSymbol}`);
  }
  return parts.length === 0 ? '0s' : parts.slice(0, 2).join(' ');
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Full local date and time, e.g. "Oct 28, 2026, 14:03:12". */
export function formatDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return MISSING_VALUE_PLACEHOLDER;
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? isoDateTime : dateTimeFormatter.format(date);
}

/** Local date only, e.g. "Oct 28, 2026". */
export function formatDate(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return MISSING_VALUE_PLACEHOLDER;
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime())
    ? isoDateTime
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact local date and time for dense tables, e.g. "Oct 28, 14:03:12". */
export function formatShortDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return MISSING_VALUE_PLACEHOLDER;
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? isoDateTime : shortDateTimeFormatter.format(date);
}

/** X-axis label for a time bucket; shows the date only when the range spans days. */
export function formatTimeAxisTick(epochMilliseconds: number, rangeSpanMilliseconds: number): string {
  const date = new Date(epochMilliseconds);
  const oneDayMilliseconds = 24 * 60 * 60 * 1000;
  if (rangeSpanMilliseconds > 2 * oneDayMilliseconds) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Tooltip heading for a time bucket. */
export function formatBucketHeading(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
