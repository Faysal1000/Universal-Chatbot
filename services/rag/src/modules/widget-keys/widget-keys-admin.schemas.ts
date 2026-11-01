import { z } from 'zod';

import { normaliseWebsiteOrigin } from './widget-key-format.js';

const MAX_ALLOWED_ORIGINS = 50;
const DEFAULT_TURNS_PER_MINUTE = 60;

const websiteOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .transform((value, context) => {
    const origin = normaliseWebsiteOrigin(value);
    if (origin === null) {
      context.addIssue({
        code: 'custom',
        message: `"${value}" is not a website origin such as https://www.example.com (no path or wildcard).`,
      });
      return z.NEVER;
    }
    return origin;
  });

const allowedOriginsSchema = z
  .array(websiteOriginSchema)
  .min(1)
  .max(MAX_ALLOWED_ORIGINS)
  .transform((origins) => [...new Set(origins)])
  .describe('Websites (scheme, host and port) whose pages may use the key');

const turnsPerMinuteSchema = z
  .number()
  .int()
  .min(1)
  .max(10_000)
  .describe('Answers per minute across every visitor of this key, on top of the per-visitor limits');

export const createWidgetKeySchema = z.object({
  name: z.string().trim().min(1).max(120).describe('Which website this key is for'),
  allowedOrigins: allowedOriginsSchema,
  turnsPerMinute: turnsPerMinuteSchema.default(DEFAULT_TURNS_PER_MINUTE),
});
export type CreateWidgetKeyRequest = z.infer<typeof createWidgetKeySchema>;

export const updateWidgetKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    allowedOrigins: allowedOriginsSchema,
    turnsPerMinute: turnsPerMinuteSchema,
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, { message: 'Send at least one field to change.' });
export type UpdateWidgetKeyRequest = z.infer<typeof updateWidgetKeySchema>;

export const widgetKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  publishableKey: z.string().describe('Public by design: goes into the page as the api-key attribute'),
  allowedOrigins: z.array(z.string()),
  turnsPerMinute: z.number().int(),
  status: z.enum(['active', 'revoked']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type WidgetKeyView = z.infer<typeof widgetKeySchema>;
