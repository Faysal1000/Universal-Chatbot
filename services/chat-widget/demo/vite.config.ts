import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Demo host pages (plain HTML, React, Vue) for development and the end-to-end tests. They use the BUILT
 * package, as real sites would: React and Vue import it through their bundler, the plain page loads it from
 * `/cdn/` like a CDN script. Run `npm run build` first.
 */
const DIST_DIRECTORY = fileURLToPath(new URL('../dist', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Serves `dist/` under `/cdn/`, standing in for jsDelivr or a self-hosted copy. */
function serveBuiltPackage(): Plugin {
  return {
    name: 'chat-widget-demo:serve-built-package',
    configureServer(server) {
      server.middlewares.use('/cdn', (request, response, next) => {
        const relativePath = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
        const filePath = join(DIST_DIRECTORY, relativePath);
        if (!filePath.startsWith(DIST_DIRECTORY) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }
        response.setHeader('Content-Type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(filePath).pipe(response);
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  envPrefix: 'VITE_DEMO_',
  plugins: [
    serveBuiltPackage(),
    react(),
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'universal-chat-bot' } } }),
  ],
  resolve: {
    alias: { '@faysal1000/universal-chatbot': join(DIST_DIRECTORY, 'universal-chat-bot.js') },
  },
  server: {
    host: true,
    port: Number(process.env.CHAT_WIDGET_DEMO_PORT ?? 5391),
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
