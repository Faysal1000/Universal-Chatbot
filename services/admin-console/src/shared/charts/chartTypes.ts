/** Chart-ready rows and series shared by every time-series chart. */

/** One x-position on a chart. Series values live under `series<N>` keys. */
export interface ChartRow {
  bucketEpochMilliseconds: number;
  [seriesDataKey: string]: number | null;
}

export interface ChartSeries {
  /** Recharts data key: synthetic so group names containing dots or slashes are safe. */
  dataKey: string;
  label: string;
  color: string;
}

export interface ChartData {
  rows: ChartRow[];
  series: ChartSeries[];
}
