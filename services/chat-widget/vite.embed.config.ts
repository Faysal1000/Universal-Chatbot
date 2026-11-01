import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/** `dist/embed.js`: a tiny classic script that loads the module build from the same folder. */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
      formats: ['iife'],
      name: 'UniversalChatBotEmbed',
      fileName: () => 'embed.js',
    },
  },
});
