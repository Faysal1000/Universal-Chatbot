import type { PageInspection } from '../../contracts/generated/parse-inspect.v1.js';
import type { PagePlan } from '../../contracts/generated/parse-pages.v1.js';

export interface PageBatchPlanningOptions {
  readonly pagesPerBatch: number;
  /** Pages that may go to the vision model in the whole document. */
  readonly visionModelPageBudget: number;
}

export interface PageBatch {
  readonly batchNumber: number;
  /** Never empty: a batch exists only for at least one page. */
  readonly pages: [PagePlan, ...PagePlan[]];
  readonly visionModelCallBudget: number;
}

/**
 * Decides how each page is parsed and groups pages into parse jobs:
 * - simple digital pages are read from the text layer;
 * - scanned or hybrid pages, and digital pages with tables, formulas, charts or
 *   several columns, go to the `document_parse` vision task;
 * - once the document's vision budget is spent, remaining pages fall back to
 *   native extraction or OCR in the parser.
 */
export function planPageBatches(
  pages: readonly PageInspection[],
  options: PageBatchPlanningOptions,
): PageBatch[] {
  let remainingVisionPages = options.visionModelPageBudget;
  const pagePlans = [...pages]
    .sort((first, second) => first.pageNumber - second.pageNumber)
    .map((page): PagePlan => {
      const useVisionModel = needsVisionModel(page) && remainingVisionPages > 0;
      if (useVisionModel) remainingVisionPages -= 1;
      return {
        pageNumber: page.pageNumber,
        pageKind: page.pageKind,
        useVisionModelFor: useVisionModel ? ['document_parse'] : [],
      };
    });
  return groupIntoBatches(pagePlans, options.pagesPerBatch);
}

function needsVisionModel(page: PageInspection): boolean {
  if (page.pageKind !== 'digital') return true;
  const { hasTables, hasFormulas, hasCharts, hasMultipleColumns } = page.complexity;
  return hasTables || hasFormulas || hasCharts || hasMultipleColumns;
}

function groupIntoBatches(pagePlans: readonly PagePlan[], pagesPerBatch: number): PageBatch[] {
  const batches: PageBatch[] = [];
  for (let offset = 0; offset < pagePlans.length; offset += pagesPerBatch) {
    const batchPages = pagePlans.slice(offset, offset + pagesPerBatch) as [PagePlan, ...PagePlan[]];
    batches.push({
      batchNumber: batches.length + 1,
      pages: batchPages,
      visionModelCallBudget: batchPages.filter((page) => page.useVisionModelFor.length > 0).length,
    });
  }
  return batches;
}
