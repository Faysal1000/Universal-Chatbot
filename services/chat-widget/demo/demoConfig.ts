/**
 * The demo host pages take the widget's attributes from the query string, so the end-to-end tests (and a
 * developer) can point one page at any key, backend and position:
 *   /plain/?api-key=pk_…&api-url=http://localhost:8080&position=top-left
 * Unset values fall back to VITE_DEMO_WIDGET_API_KEY / VITE_DEMO_WIDGET_API_URL.
 */
const ATTRIBUTE_NAMES = [
  'api-key',
  'api-url',
  'primary-color',
  'theme',
  'position',
  'offset-x',
  'offset-y',
  'greeting',
  'greeting-duration-ms',
  'language',
] as const;

const ENV_FALLBACKS: Partial<Record<(typeof ATTRIBUTE_NAMES)[number], string | undefined>> = {
  'api-key': import.meta.env.VITE_DEMO_WIDGET_API_KEY as string | undefined,
  'api-url': (import.meta.env.VITE_DEMO_WIDGET_API_URL as string | undefined) ?? 'http://localhost:8080',
};

export function demoWidgetAttributes(search: string = window.location.search): Record<string, string> {
  const query = new URLSearchParams(search);
  const attributes: Record<string, string> = {};
  for (const name of ATTRIBUTE_NAMES) {
    const value = query.get(name) ?? ENV_FALLBACKS[name];
    if (value !== undefined) attributes[name] = value;
  }
  return attributes;
}
