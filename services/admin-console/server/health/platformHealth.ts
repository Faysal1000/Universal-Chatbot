/**
 * Probes every service's readiness endpoint in parallel, with a short timeout, and reports one
 * row per service. Results are cached briefly so many open consoles do not multiply the probes.
 */

type HealthStatus = 'ready' | 'not_ready' | 'unreachable' | 'not_configured';

export interface HealthTarget {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly url: string | undefined;
}

export interface DependencyCheck {
  name: string;
  status: string;
}

export interface ServiceHealth {
  id: string;
  name: string;
  role: string;
  status: HealthStatus;
  httpStatus: number | null;
  latencyMilliseconds: number | null;
  detail: string | null;
  dependencies: DependencyCheck[];
  checkedAt: string;
}

const CACHE_MILLISECONDS = 5_000;

/** Accepts `checks` as `{ name: status }` (rag) or `[{ name, status }]`. */
export function readDependencies(body: unknown): DependencyCheck[] {
  if (typeof body !== 'object' || body === null || !('checks' in body)) return [];
  const { checks } = body;
  if (Array.isArray(checks)) {
    return checks.flatMap((check: unknown) => {
      if (typeof check !== 'object' || check === null) return [];
      const { name, status } = check as Record<string, unknown>;
      return typeof name === 'string' && typeof status === 'string' ? [{ name, status }] : [];
    });
  }
  if (typeof checks !== 'object' || checks === null) return [];
  return Object.entries(checks as Record<string, unknown>).flatMap(([name, status]) =>
    typeof status === 'string' ? [{ name, status }] : [],
  );
}

function readDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { detail, status } = body as Record<string, unknown>;
  if (typeof detail === 'string') return detail;
  return typeof status === 'string' ? status : null;
}

export async function probe(target: HealthTarget, timeoutMilliseconds: number, now = Date.now): Promise<ServiceHealth> {
  const base = { id: target.id, name: target.name, role: target.role, dependencies: [] as DependencyCheck[] };
  const checkedAt = new Date(now()).toISOString();
  if (target.url === undefined) {
    return { ...base, status: 'not_configured', httpStatus: null, latencyMilliseconds: null, detail: null, checkedAt };
  }
  const startedAt = performance.now();
  try {
    const response = await fetch(target.url, { signal: AbortSignal.timeout(timeoutMilliseconds) });
    const latencyMilliseconds = Math.round(performance.now() - startedAt);
    const body: unknown = await response.json().catch(() => null);
    return {
      ...base,
      status: response.ok ? 'ready' : 'not_ready',
      httpStatus: response.status,
      latencyMilliseconds,
      detail: readDetail(body),
      dependencies: readDependencies(body),
      checkedAt,
    };
  } catch (error) {
    return {
      ...base,
      status: 'unreachable',
      httpStatus: null,
      latencyMilliseconds: null,
      detail:
        (error as Error).name === 'TimeoutError' ? `no answer within ${timeoutMilliseconds} ms` : 'connection failed',
      checkedAt,
    };
  }
}

export class PlatformHealth {
  readonly #targets: readonly HealthTarget[];
  readonly #timeoutMilliseconds: number;
  #cached: { at: number; result: Promise<ServiceHealth[]> } | undefined;

  constructor(targets: readonly HealthTarget[], timeoutMilliseconds: number) {
    this.#targets = targets;
    this.#timeoutMilliseconds = timeoutMilliseconds;
  }

  check(): Promise<ServiceHealth[]> {
    const now = Date.now();
    if (this.#cached === undefined || now - this.#cached.at > CACHE_MILLISECONDS) {
      this.#cached = {
        at: now,
        result: Promise.all(this.#targets.map((target) => probe(target, this.#timeoutMilliseconds))),
      };
    }
    return this.#cached.result;
  }
}
