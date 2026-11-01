import { describe, expect, it } from 'vitest';

import type { PageInspection } from '../../contracts/generated/parse-inspect.v1.js';
import { planPageBatches } from './page-batch-planner.js';

const SIMPLE = {
  hasTables: false,
  hasFormulas: false,
  hasCharts: false,
  hasImages: false,
  hasMultipleColumns: false,
};

function page(pageNumber: number, overrides: Partial<PageInspection> = {}): PageInspection {
  return {
    pageNumber,
    pageKind: 'digital',
    widthPoints: 595,
    heightPoints: 842,
    textCoverageRatio: 0.6,
    complexity: SIMPLE,
    ...overrides,
  };
}

describe('planPageBatches', () => {
  it('reads simple digital pages natively and sends complex or scanned pages to the vision model', () => {
    const [batch] = planPageBatches(
      [
        page(1),
        page(2, { complexity: { ...SIMPLE, hasTables: true } }),
        page(3, { pageKind: 'scanned', textCoverageRatio: 0 }),
        page(4, { complexity: { ...SIMPLE, hasMultipleColumns: true } }),
        page(5, { complexity: { ...SIMPLE, hasImages: true } }),
      ],
      { pagesPerBatch: 10, visionModelPageBudget: 100 },
    );

    expect(batch?.pages.map((plan) => plan.useVisionModelFor)).toEqual([
      [],
      ['document_parse'],
      ['document_parse'],
      ['document_parse'],
      [],
    ]);
    expect(batch?.visionModelCallBudget).toBe(3);
  });

  it('groups pages in order into numbered batches of the configured size', () => {
    const batches = planPageBatches([page(3), page(1), page(2), page(4), page(5)], {
      pagesPerBatch: 2,
      visionModelPageBudget: 0,
    });

    expect(batches.map((batch) => [batch.batchNumber, batch.pages.map((plan) => plan.pageNumber)])).toEqual([
      [1, [1, 2]],
      [2, [3, 4]],
      [3, [5]],
    ]);
  });

  it('stops using the vision model once the document budget is spent', () => {
    const scannedPages = [1, 2, 3].map((pageNumber) => page(pageNumber, { pageKind: 'scanned' }));

    const [batch] = planPageBatches(scannedPages, { pagesPerBatch: 8, visionModelPageBudget: 2 });

    expect(batch?.pages.map((plan) => plan.useVisionModelFor.length)).toEqual([1, 1, 0]);
    expect(batch?.visionModelCallBudget).toBe(2);
  });
});
