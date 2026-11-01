/**
 * TypeScript mirror of the shared API models in the backend.
 * Field names stay snake_case so payloads pass through unchanged.
 */

/** ISO-8601 datetime with timezone, e.g. `2026-10-28T12:00:00+00:00`. */
export type IsoDateTimeString = string;

/** One FastAPI/pydantic validation error. */
export interface ValidationErrorDetail {
  loc: (string | number)[];
  msg: string;
  type?: string;
}
