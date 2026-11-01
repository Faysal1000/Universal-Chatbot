import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/** Vendor code split into long-cached chunks; the first matching pattern wins. */
const VENDOR_CHUNKS: readonly (readonly [string, RegExp])[] = [
  ['react', /node_modules\/(react|react-dom|scheduler)\//],
  ['ui', /node_modules\/(@radix-ui|lucide-react)/],
  ['platform', /node_modules\/(zod|i18next|react-i18next)/],
  ['katex', /node_modules\/katex/],
  ['highlight', /node_modules\/highlight\.js/],
  ['markdown', /node_modules\/(react-markdown|micromark|mdast|hast)/],
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'CHAT_');
  // The rag api of the root docker-compose.yml. Proxying keeps the browser same-origin in development.
  const ragApiOrigin = env.CHAT_DEV_RAG_API_URL ?? 'http://localhost:8080';

  return {
    envPrefix: 'VITE_CHAT_',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@chat-core': fileURLToPath(new URL('./chat-core', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(env.CHAT_DEV_SERVER_PORT ?? 5190),
      strictPort: true,
      proxy: { '/v1': { target: ragApiOrigin, changeOrigin: true } },
    },
    preview: { port: 5191, strictPort: true },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // The stylesheet stays with the entry; only the (lazily loaded) script goes to the katex chunk.
            if (id.includes('node_modules/katex') && id.endsWith('.css')) return undefined;
            return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0];
          },
        },
      },
    },
  };
});
