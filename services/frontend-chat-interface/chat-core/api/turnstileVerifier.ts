/**
 * Obtains a Cloudflare Turnstile token when the backend requires one (`turnstileSiteKey` in `/config`).
 * Renders an invisible/managed widget into a detached container; resolves `null` when no site key is set.
 */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      appearance?: 'always' | 'execute' | 'interaction-only';
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoad: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile failed to initialise'));
    };
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.append(script);
  });
  return scriptLoad;
}

/**
 * `mountInto` hosts the challenge when Cloudflare needs an interaction: the page body for the chat app, the
 * widget's own panel for the website widget.
 */
export async function obtainTurnstileToken(
  siteKey: string | null,
  mountInto: HTMLElement = document.body,
): Promise<string | null> {
  if (!siteKey) return null;
  const turnstile = await loadTurnstileScript();
  const container = document.createElement('div');
  container.className = 'turnstile-container';
  mountInto.append(container);

  return new Promise<string>((resolve, reject) => {
    const widgetId = turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: (token) => {
        turnstile.remove(widgetId);
        container.remove();
        resolve(token);
      },
      'error-callback': () => {
        turnstile.remove(widgetId);
        container.remove();
        reject(new Error('Turnstile verification failed'));
      },
    });
  });
}
