const UNIQUE_VIOLATION_CODE = '23505';

/** True for a Postgres unique-constraint violation, also when wrapped by Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCodeOf(error) === UNIQUE_VIOLATION_CODE;
}

/** The violated constraint's name, or undefined when `error` is no unique violation. */
export function uniqueViolationConstraintOf(error: unknown): string | undefined {
  const postgresError = postgresErrorOf(error);
  if (postgresError?.code !== UNIQUE_VIOLATION_CODE) return undefined;
  return typeof postgresError.constraint === 'string' ? postgresError.constraint : '';
}

function postgresErrorCodeOf(error: unknown): string | undefined {
  return postgresErrorOf(error)?.code;
}

/** node-postgres errors carry `code`; Drizzle wraps them as `cause`. */
function postgresErrorOf(error: unknown): { code: string; constraint?: unknown } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return { code: candidate.code, constraint: candidate.constraint };
    current = candidate.cause;
  }
  return undefined;
}
