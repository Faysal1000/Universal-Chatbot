/**
 * A failure that retrying cannot fix (corrupt file, contract violation, over a limit).
 * The worker host turns it into BullMQ's UnrecoverableError so the job fails at once,
 * and `failureCode` is what the admin console shows.
 */
export class PermanentJobError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
