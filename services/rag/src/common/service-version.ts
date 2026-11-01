import { readFileSync } from 'node:fs';

/** Reads the version from package.json once; the image ships package.json next to dist/. */
function readServiceVersion(): string {
  try {
    const packageManifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof packageManifest.version === 'string' ? packageManifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVICE_VERSION = readServiceVersion();
