import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Where `npm run dev` forwards `/api` (the BFF started by `npm run dev:server`). */
const developmentBffUrl = process.env.ADMIN_CONSOLE_DEV_BFF_URL ?? 'http://localhost:8086';

/** The CSP allows fonts from this origin only (`font-src 'self'`), so fonts are never inlined as data URLs. */
function inlineUnlessFont(filePath: string): boolean | undefined {
  return filePath.endsWith('.woff2') || filePath.endsWith('.woff') ? false : undefined;
}

/** Path the console is served under (`/admin/` behind the Hugging Face Space's nginx). */
const basePath = process.env.ADMIN_CONSOLE_BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5180,
    proxy: { '/api': { target: developmentBffUrl, changeOrigin: false } },
  },
  build: { outDir: 'dist/web', sourcemap: false, emptyOutDir: true, assetsInlineLimit: inlineUnlessFont },
});
