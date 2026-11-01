import type { Job } from 'bullmq';

import { describeJobFailure } from '../../queue/queue-worker-host.service.js';

/** Results of a flow parent's children, read once so services never touch BullMQ. */
export interface FlowChildrenOutcome {
  readonly results: readonly unknown[];
  readonly failures: readonly { readonly failureCode: string; readonly failureMessage: string }[];
}

export async function readFlowChildrenOutcome(job: Job): Promise<FlowChildrenOutcome> {
  const [childValues, ignoredFailures] = await Promise.all([
    job.getChildrenValues(),
    job.getIgnoredChildrenFailures(),
  ]);
  return {
    results: Object.values(childValues),
    failures: Object.values(ignoredFailures).map((failedReason) => describeJobFailure(failedReason)),
  };
}
