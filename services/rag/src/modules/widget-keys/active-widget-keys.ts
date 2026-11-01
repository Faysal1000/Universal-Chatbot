/** What the public API needs to know about one active (not revoked) widget key. */
export interface ActiveWidgetKey {
  readonly id: string;
  readonly publishableKey: string;
  readonly allowedOrigins: readonly string[];
  readonly turnsPerMinute: number;
}

/** An in-memory view of every active widget key, indexed for per-request lookups. */
export class ActiveWidgetKeys {
  private readonly byPublishableKey = new Map<string, ActiveWidgetKey>();
  private readonly byId = new Map<string, ActiveWidgetKey>();
  private readonly allowedOrigins = new Set<string>();

  constructor(keys: readonly ActiveWidgetKey[]) {
    for (const key of keys) {
      this.byPublishableKey.set(key.publishableKey, key);
      this.byId.set(key.id, key);
      for (const origin of key.allowedOrigins) this.allowedOrigins.add(origin);
    }
  }

  findByPublishableKey(publishableKey: string): ActiveWidgetKey | undefined {
    return this.byPublishableKey.get(publishableKey);
  }

  findById(widgetKeyId: string): ActiveWidgetKey | undefined {
    return this.byId.get(widgetKeyId);
  }

  /** Whether some active key lists this origin (for CORS, which cannot see the key on a preflight). */
  isAnyKeysOrigin(origin: string): boolean {
    return this.allowedOrigins.has(origin);
  }
}
