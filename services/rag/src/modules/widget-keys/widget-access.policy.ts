import type { IncomingHttpHeaders } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../common/errors/application-error.js';
import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { type ActiveWidgetKey, ActiveWidgetKeys } from './active-widget-keys.js';
import { presentedWidgetKey, requestingOrigin } from './widget-key-format.js';
import { WidgetKeysRepository } from './widget-keys.repository.js';

/**
 * Active keys are cached this long. Changes made through this process apply at once (the cache is dropped);
 * other api replicas see a revocation within this window.
 */
const WIDGET_KEY_CACHE_TTL_MILLISECONDS = 10_000;

/** The widget key a public request (or its visitor session) is using. */
export interface WidgetGrant {
  readonly widgetKeyId: string;
  readonly turnsPerMinute: number;
}

/**
 * Who may use the public chat from which website. A publishable key is public, so on its own it proves nothing:
 * the browser-supplied `Origin` must be one the key lists. Origins in `RAG_PUBLIC_CORS_ALLOWED_ORIGINS` (the
 * first-party chat app) need no key; an origin that is allowed only through widget keys must present one.
 */
@Injectable()
export class WidgetAccessPolicy {
  private readonly firstPartyOrigins: ReadonlySet<string>;
  private cached: { keys: ActiveWidgetKeys; loadedAt: number } | null = null;
  private pendingLoad: Promise<ActiveWidgetKeys> | null = null;
  private generation = 0;

  constructor(
    private readonly widgetKeysRepository: WidgetKeysRepository,
    @Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration,
  ) {
    this.firstPartyOrigins = new Set(configuration.publicAccess.corsAllowedOrigins);
  }

  /** CORS: the first-party origins plus every origin an active widget key lists. */
  async isCorsOriginAllowed(origin: string): Promise<boolean> {
    if (this.firstPartyOrigins.has(origin)) return true;
    return (await this.activeKeys()).isAnyKeysOrigin(origin);
  }

  /** `GET /config` and `POST /sessions`: checks the presented key, if any, against the page's origin. */
  async authorizeRequest(headers: IncomingHttpHeaders): Promise<WidgetGrant | null> {
    const publishableKey = presentedWidgetKey(headers);
    const origin = requestingOrigin(headers);
    const keys = await this.activeKeys();
    if (publishableKey === null) {
      if (origin !== null && !this.firstPartyOrigins.has(origin) && keys.isAnyKeysOrigin(origin)) {
        throw widgetError('widget_key_required', 'Requests from this website must send its widget key.');
      }
      return null;
    }
    const key = keys.findByPublishableKey(publishableKey);
    if (key === undefined) {
      throw widgetError('widget_key_invalid', 'This widget key is unknown or was revoked.');
    }
    return grantFor(key, origin);
  }

  /** Requests with a visitor session started through a widget: the key must still be active, the origin listed. */
  async authorizeSession(widgetKeyId: string, headers: IncomingHttpHeaders): Promise<WidgetGrant> {
    const key = (await this.activeKeys()).findById(widgetKeyId);
    if (key === undefined) {
      throw widgetError('widget_key_revoked', 'The widget key of this chat was revoked.');
    }
    return grantFor(key, requestingOrigin(headers));
  }

  /** Called after an admin change so this process applies it immediately. */
  invalidate(): void {
    this.cached = null;
    this.pendingLoad = null;
    this.generation += 1;
  }

  private async activeKeys(): Promise<ActiveWidgetKeys> {
    if (this.cached !== null && Date.now() - this.cached.loadedAt < WIDGET_KEY_CACHE_TTL_MILLISECONDS) {
      return this.cached.keys;
    }
    if (this.pendingLoad === null) {
      const load = this.loadActiveKeys().finally(() => {
        if (this.pendingLoad === load) this.pendingLoad = null;
      });
      this.pendingLoad = load;
    }
    return this.pendingLoad;
  }

  /** A load that started before `invalidate()` may hold revoked keys, so it is not cached. */
  private async loadActiveKeys(): Promise<ActiveWidgetKeys> {
    const startedGeneration = this.generation;
    const keys = new ActiveWidgetKeys(await this.widgetKeysRepository.listActive());
    if (this.generation === startedGeneration) this.cached = { keys, loadedAt: Date.now() };
    return keys;
  }
}

function grantFor(key: ActiveWidgetKey, origin: string | null): WidgetGrant {
  if (origin === null || !key.allowedOrigins.includes(origin)) {
    throw widgetError('widget_origin_not_allowed', 'This website is not allowed to use this widget key.', {
      ...(origin === null ? {} : { origin }),
    });
  }
  return { widgetKeyId: key.id, turnsPerMinute: key.turnsPerMinute };
}

function widgetError(code: string, message: string, details?: Record<string, string>): ApplicationError {
  return new ApplicationError(403, code, message, details === undefined ? {} : { details });
}
