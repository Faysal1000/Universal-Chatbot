import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

import { CHAT_CORE_DIRECTORY, resolveChatCoreDependenciesFromWidget } from './build/chatCore';

/**
 * Two outputs from one build: `dist/universal-chat-bot.js` (the npm entry and the CDN script; small, registers
 * the element) and hashed chunks next to it (the chat panel, loaded on first use). `base: './'` makes chunk and
 * font URLs resolve against the script's own URL, so the same files work from npm bundles, a CDN or any host.
 *
 * `npm run dev` rebuilds on change; `npm run demo` serves the demo host pages in `demo/` (see its config).
 */
const VENDOR_CHUNKS: readonly (readonly [chunk: string, pattern: RegExp])[] = [
  ['react', /node_modules\/(react|react-dom|scheduler)\//],
  [
    'markdown',
    /node_modules\/(react-markdown|micromark[^/]*|mdast[^/]*|hast[^/]*|unified|remark-[^/]+|vfile[^/]*)\//,
  ],
  ['platform', /node_modules\/(zod|i18next|react-i18next|zustand)\//],
  ['ui', /node_modules\/(@radix-ui|@floating-ui|lucide-react)\//],
];

function vendorChunkOf(id: string): string | undefined {
  return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0];
}

export default defineConfig({
  base: './',
  plugins: [resolveChatCoreDependenciesFromWidget(), react(), tailwindcss()],
  resolve: {
    alias: { '@chat-core': CHAT_CORE_DIRECTORY },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    // Preload hints are resolved against import.meta.url, which a host's bundler (Next.js, webpack) may rewrite
    // to a file:// path the browser refuses. The chunks still load through the dynamic import itself.
    modulePreload: false,
    rollupOptions: {
      input: { 'universal-chat-bot': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      preserveEntrySignatures: 'exports-only',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Libraries change less often than the widget: separate chunks stay cached across releases.
        manualChunks: vendorChunkOf,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setupTests.ts'],
    css: false,
  },
});
