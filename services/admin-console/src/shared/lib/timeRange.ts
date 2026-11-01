/** Dashboard time-range presets and resolution of a preset into a concrete window. */

export type TimeRangePresetId = '24h' | '7d' | '30d';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

const DURATION_MILLISECONDS_BY_PRESET: Record<TimeRangePresetId, number> = {
  '24h': DAY_MILLISECONDS,
  '7d': 7 * DAY_MILLISECONDS,
  '30d': 30 * DAY_MILLISECONDS,
};

/** A concrete window as ISO-8601 strings (UTC, with `Z`) ready for the API. */
export interface ResolvedTimeWindow {
  start: string;
  end: string;
}

/** The preset's window ending at `nowEpochMilliseconds`. */
export function resolveTimeWindow(presetId: TimeRangePresetId, nowEpochMilliseconds: number): ResolvedTimeWindow {
  return {
    start: new Date(nowEpochMilliseconds - DURATION_MILLISECONDS_BY_PRESET[presetId]).toISOString(),
    end: new Date(nowEpochMilliseconds).toISOString(),
  };
}
