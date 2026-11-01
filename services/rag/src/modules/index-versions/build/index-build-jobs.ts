import { z } from 'zod';

export const indexBuildPayloadSchema = z.object({ indexVersionId: z.number().int().positive() });
export type IndexBuildPayload = z.infer<typeof indexBuildPayloadSchema>;

/** One id per request, so a resumed build is never swallowed by a finished job's id. */
export function indexBuildJobId(indexVersionId: number, requestedAt: Date): string {
  return `index.${indexVersionId}.${requestedAt.getTime()}`;
}
