/**
 * Turns rag's ingestion server-sent events into what the progress bar shows.
 * rag emits `progress` ({ documentId, status, run }) whenever the document status or its
 * latest run changes, `deleted` ({ documentId }) if the document disappears, and ends the
 * stream once the document is `ready` or `failed`.
 */
import { z } from 'zod';

import type { PlacardState } from '@/shared/ui/StatePlacard';

import { DOCUMENT_STATUSES, INGESTION_STAGES } from './api/documentTypes';
import { documentStatusPlacard, ingestionStageLabel, isDocumentSettled } from './documentStatusModel';

export const PROGRESS_EVENT_NAME = 'progress';
export const DELETED_EVENT_NAME = 'deleted';

export interface IngestionProgressView {
  placardState: PlacardState;
  /** e.g. "Parsing pages", "Ready", "Failed". */
  label: string;
  /** 0–100. */
  percent: number;
  /** e.g. "12 of 40 pages"; null before the page count is known. */
  pagesLabel: string | null;
  isSettled: boolean;
  failure: { code: string; message: string } | null;
}

const COMPLETE_PERCENT = 100;

const progressEventSchema = z.object({
  documentId: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  run: z
    .object({
      stage: z.enum(INGESTION_STAGES),
      progressPercent: z.number(),
      pages: z.object({ total: z.number().nullable(), parsed: z.number() }),
      failure: z.object({ code: z.string(), message: z.string() }).nullable(),
    })
    .nullable(),
});

export type ParsedProgressEvent = z.infer<typeof progressEventSchema>;

/** Parses the `data` of a `progress` event; null when it is not the shape rag documents. */
export function parseProgressEventData(eventData: string): ParsedProgressEvent | null {
  try {
    const parsed = progressEventSchema.safeParse(JSON.parse(eventData));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What the progress bar shows for one `progress` event. */
export function describeIngestionProgress(event: ParsedProgressEvent): IngestionProgressView {
  const isSettled = isDocumentSettled(event.status);
  return {
    placardState: documentStatusPlacard(event.status).state,
    label: progressLabel(event),
    percent: progressPercent(event),
    pagesLabel: pagesLabel(event),
    isSettled,
    failure: event.status === 'failed' ? (event.run?.failure ?? null) : null,
  };
}

/** The view shown after rag reports the document gone (deleted while it was being watched). */
export function deletedIngestionProgress(): IngestionProgressView {
  return {
    placardState: 'disabled',
    label: 'Deleted',
    percent: 0,
    pagesLabel: null,
    isSettled: true,
    failure: null,
  };
}

/** The view before the first event arrives. */
export function waitingIngestionProgress(): IngestionProgressView {
  return {
    placardState: 'working',
    label: 'Waiting for ingestion',
    percent: 0,
    pagesLabel: null,
    isSettled: false,
    failure: null,
  };
}

function progressLabel(event: ParsedProgressEvent): string {
  if (isDocumentSettled(event.status) || event.status === 'deleting' || event.run === null) {
    return documentStatusPlacard(event.status).label;
  }
  return ingestionStageLabel(event.run.stage);
}

function progressPercent(event: ParsedProgressEvent): number {
  if (event.status === 'ready') return COMPLETE_PERCENT;
  const reportedPercent = event.run?.progressPercent ?? 0;
  return Math.min(COMPLETE_PERCENT, Math.max(0, Math.round(reportedPercent)));
}

function pagesLabel(event: ParsedProgressEvent): string | null {
  const totalPages = event.run?.pages.total;
  if (totalPages === undefined || totalPages === null) return null;
  return `${event.run?.pages.parsed ?? 0} of ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`;
}
