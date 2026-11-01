const VERTICAL_EDGES = ['top', 'middle', 'bottom'] as const;
const HORIZONTAL_EDGES = ['left', 'center', 'right'] as const;

export type VerticalEdge = (typeof VERTICAL_EDGES)[number];
export type HorizontalEdge = (typeof HORIZONTAL_EDGES)[number];
export type WidgetPosition = `${VerticalEdge}-${HorizontalEdge}`;

const DEFAULT_POSITION: WidgetPosition = 'bottom-right';

export const WIDGET_POSITIONS: readonly WidgetPosition[] = VERTICAL_EDGES.flatMap((vertical) =>
  HORIZONTAL_EDGES.map((horizontal): WidgetPosition => `${vertical}-${horizontal}`),
);

export interface WidgetPlacement {
  vertical: VerticalEdge;
  horizontal: HorizontalEdge;
}

/** Reads a `position` attribute such as `bottom-right` or `middle-left`; anything else falls back to the default. */
export function parseWidgetPosition(value: string | null): WidgetPosition {
  const normalised = value?.trim().toLowerCase() ?? '';
  return (WIDGET_POSITIONS as readonly string[]).includes(normalised)
    ? (normalised as WidgetPosition)
    : DEFAULT_POSITION;
}

export function placementOf(position: WidgetPosition): WidgetPlacement {
  const [vertical, horizontal] = position.split('-') as [VerticalEdge, HorizontalEdge];
  return { vertical, horizontal };
}
