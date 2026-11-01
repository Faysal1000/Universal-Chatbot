/**
 * Classic-script loader for pages (or CMSs such as WordPress) that cannot add `type="module"` scripts:
 * `<script src=".../embed.js" async></script>` loads the module build next to it, which registers
 * `<universal-chat-bot>`.
 */
const loaderScript = document.currentScript;

if (loaderScript instanceof HTMLScriptElement && !customElements.get('universal-chat-bot')) {
  const moduleUrl = new URL('./universal-chat-bot.js', loaderScript.src).href;
  import(/* @vite-ignore */ moduleUrl).catch((error: unknown) => {
    console.error('<universal-chat-bot>: the widget script could not be loaded.', error);
  });
}
