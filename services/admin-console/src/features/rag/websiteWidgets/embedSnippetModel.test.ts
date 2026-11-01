import { expect, it } from 'vitest';

import { CDN_SCRIPT_URL, npmSnippet, scriptTagSnippet } from './embedSnippetModel';

const KEY = 'pk_shop_aaaaaaaaaaaaaaaaaaaaaaaa';

it('npmSnippet installs, imports, then uses the element with the key', () => {
  expect(npmSnippet(KEY)).toBe(
    `npm install @faysal1000/universal-chatbot\n\nimport '@faysal1000/universal-chatbot';\n\n` +
      `<universal-chat-bot\n  api-key="${KEY}"\n  api-url="https://your-chat-api.example.com"\n></universal-chat-bot>`,
  );
});

it('scriptTagSnippet loads the CDN script before the element', () => {
  const snippet = scriptTagSnippet(KEY);
  expect(snippet.startsWith(`<script src="${CDN_SCRIPT_URL}" async></script>\n<universal-chat-bot`)).toBe(true);
  expect(snippet).toContain(`api-key="${KEY}"`);
});
