/** A backing service the process needs to do useful work (database, queue broker, ...). */
export interface DependencyHealthCheck {
  /** Stable name reported by `/health/ready`, e.g. `postgres`. */
  readonly dependencyName: string;
  /** Resolves when the dependency is reachable; rejects (or times out) otherwise. */
  check(): Promise<void>;
}
