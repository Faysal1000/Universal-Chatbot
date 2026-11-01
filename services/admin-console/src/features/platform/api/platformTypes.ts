/** Mirrors of the BFF's platform health view (server/health). */
export type HealthStatus = 'ready' | 'not_ready' | 'unreachable' | 'not_configured';

interface DependencyCheck {
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
