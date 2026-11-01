/**
 * The minimal embed code for a key. Everything else (position, theme, colours, greeting, language) is an
 * attribute the website's developer sets in their own markup; see services/chat-widget/README.md.
 */
const WIDGET_PACKAGE_NAME = '@faysal1000/universal-chatbot';
export const CDN_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/${WIDGET_PACKAGE_NAME}@0/dist/embed.js`;
const API_URL_PLACEHOLDER = 'https://your-chat-api.example.com';

function element(publishableKey: string): string {
  return `<universal-chat-bot\n  api-key="${publishableKey}"\n  api-url="${API_URL_PLACEHOLDER}"\n></universal-chat-bot>`;
}

/** For apps with a bundler (React, Vue, Svelte…). */
export function npmSnippet(publishableKey: string): string {
  return [
    `npm install ${WIDGET_PACKAGE_NAME}`,
    '',
    `import '${WIDGET_PACKAGE_NAME}';`,
    '',
    element(publishableKey),
  ].join('\n');
}

/** For any HTML page (WordPress, plain sites): paste before `</body>`. */
export function scriptTagSnippet(publishableKey: string): string {
  return `<script src="${CDN_SCRIPT_URL}" async></script>\n${element(publishableKey)}`;
}
