/**
 * Application configuration, resolved once at startup.
 *
 * Precedence: runtime config (`/runtime-config.js`, written by the Docker entrypoint from `CHAT_RUNTIME_*`)
 * → build-time `VITE_CHAT_*` env → defaults. Runtime config lets one image target any backend.
 */
import { DEFAULT_BATCHING, type BatchingConfig } from '@chat-core/features/message-batching/chatPersistence';

export type SupportedLanguage = 'en' | 'bn';

export interface AppConfig {
  apiBaseUrl: string;
  botName: string;
  brandAccent: string;
  brandLogoUrl: string | null;
  defaultLanguage: SupportedLanguage;
  batching: BatchingConfig;
}

interface RuntimeConfig {
  apiBaseUrl?: string;
  botName?: string;
  brandAccent?: string;
  brandLogoUrl?: string;
}

declare global {
  interface Window {
    __CHAT_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const DEFAULT_BOT_NAME = 'Assistant';
const DEFAULT_BRAND_ACCENT = '#6d5dfc';

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function resolveAppConfig(
  env: Record<string, string | undefined> = import.meta.env,
  runtime: RuntimeConfig = typeof window === 'undefined' ? {} : (window.__CHAT_RUNTIME_CONFIG__ ?? {}),
): AppConfig {
  const quietWindowMinMs = positiveInt(env.VITE_CHAT_BATCH_QUIET_MIN_MS, DEFAULT_BATCHING.quietWindowMinMs);
  const quietWindowMaxMs = Math.max(
    quietWindowMinMs,
    positiveInt(env.VITE_CHAT_BATCH_QUIET_MAX_MS, DEFAULT_BATCHING.quietWindowMaxMs),
  );
  const language = env.VITE_CHAT_DEFAULT_LANGUAGE === 'bn' ? 'bn' : 'en';

  return {
    apiBaseUrl: (nonEmpty(runtime.apiBaseUrl) ?? nonEmpty(env.VITE_CHAT_API_BASE_URL) ?? '').replace(
      /\/+$/,
      '',
    ),
    botName: nonEmpty(runtime.botName) ?? nonEmpty(env.VITE_CHAT_BOT_NAME) ?? DEFAULT_BOT_NAME,
    brandAccent:
      nonEmpty(runtime.brandAccent) ?? nonEmpty(env.VITE_CHAT_BRAND_ACCENT) ?? DEFAULT_BRAND_ACCENT,
    brandLogoUrl: nonEmpty(runtime.brandLogoUrl) ?? nonEmpty(env.VITE_CHAT_BRAND_LOGO_URL) ?? null,
    defaultLanguage: language,
    batching: {
      quietWindowMinMs,
      quietWindowMaxMs,
      maxWaitMs: Math.max(
        quietWindowMaxMs,
        positiveInt(env.VITE_CHAT_BATCH_MAX_WAIT_MS, DEFAULT_BATCHING.maxWaitMs),
      ),
    },
  };
}

export const appConfig: AppConfig = resolveAppConfig();
