import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** The shared chat core lives in the chat app's folder; the widget builds it from there. */
export const CHAT_CORE_DIRECTORY = fileURLToPath(
  new URL('../../frontend-chat-interface/chat-core', import.meta.url),
);

const WIDGET_SOURCE_ANCHOR = fileURLToPath(new URL('../src/index.ts', import.meta.url));

function isPackageImport(source: string): boolean {
  return !/^(\.|\/|\0|@chat-core\/|[a-zA-Z]:)/.test(source) && !source.startsWith('virtual:');
}

/**
 * Resolves the packages the chat core imports (react, zod, …) from this package's node_modules, as if the core
 * were part of `src/`. Without it they would resolve from the chat app's node_modules: a second React, and a
 * build that depends on another package's install.
 */
export function resolveChatCoreDependenciesFromWidget(): Plugin {
  return {
    name: 'chat-widget:resolve-chat-core-dependencies',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer?.startsWith(CHAT_CORE_DIRECTORY) || !isPackageImport(source)) return null;
      return this.resolve(source, WIDGET_SOURCE_ANCHOR, { ...options, skipSelf: true });
    },
  };
}
