/**
 * The path the console is served under, without a trailing slash: empty at the site root, `/admin`
 * when a reverse proxy mounts it there. Set at build time through ADMIN_CONSOLE_BASE_PATH.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/** `path` (starting with `/`) as the browser must request it. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
