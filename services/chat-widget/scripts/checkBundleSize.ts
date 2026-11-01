/**
 * Fails the build when a part of the widget outgrows its budget. Sizes are gzip, as a CDN serves them, and each
 * part counts every chunk it statically pulls in that an earlier part did not already load.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const KIB = 1024;

interface Part {
  name: string;
  /** The chunk that starts the part; its static imports are counted with it. */
  entry: string;
  budgetBytes: number;
}

const PARTS: Part[] = [
  { name: 'embed loader (script tag)', entry: 'embed.js', budgetBytes: 1 * KIB },
  { name: 'launcher (every page view)', entry: 'universal-chat-bot.js', budgetBytes: 12 * KIB },
  { name: 'chat panel (first open)', entry: chunkNamed('mountPanel'), budgetBytes: 260 * KIB },
  { name: 'maths rendering (on demand)', entry: chunkNamed('rehype-katex'), budgetBytes: 100 * KIB },
  { name: 'code highlighting (on demand)', entry: chunkNamed('rehype-highlight'), budgetBytes: 70 * KIB },
];

const STATIC_IMPORT = /(?:from|import)\s*"(\.{1,2}\/[^"]+\.js)"/g;

/** The hashed file name of a chunk, from its name in the build. */
function chunkNamed(prefix: string): string {
  const file = readdirSync(join(DIST, 'chunks')).find(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith('.js'),
  );
  if (!file) throw new Error(`No built chunk starts with "${prefix}"; run the build first.`);
  return join('chunks', file);
}

/** The chunk and everything it statically imports, as paths relative to dist. */
function staticGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(join(DIST, entry), 'utf8');
  for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
    if (specifier) staticGraph(join(dirname(entry), specifier), seen);
  }
  return seen;
}

function gzipSize(file: string): number {
  return gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length;
}

const alreadyLoaded = new Set<string>();
let overBudget = 0;
for (const part of PARTS) {
  const chunks = [...staticGraph(part.entry)].filter((chunk) => !alreadyLoaded.has(chunk));
  const bytes = chunks.reduce((total, chunk) => total + gzipSize(chunk), 0);
  const verdict = bytes <= part.budgetBytes ? 'ok  ' : 'OVER';
  if (bytes > part.budgetBytes) overBudget += 1;
  console.log(
    `${verdict} ${part.name.padEnd(32)} ${(bytes / KIB).toFixed(1).padStart(6)} KiB / ${part.budgetBytes / KIB} KiB` +
      `  (${chunks.map((chunk) => basename(chunk)).join(', ')})`,
  );
  if (part.entry !== 'embed.js') chunks.forEach((chunk) => alreadyLoaded.add(chunk));
}

if (overBudget > 0) {
  console.error(`\n${overBudget} part(s) over budget.`);
  process.exit(1);
}
