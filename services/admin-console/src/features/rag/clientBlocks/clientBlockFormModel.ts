import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { isUuid } from '@/shared/lib/uuid';
import type { PlacardState } from '@/shared/ui/StatePlacard';

import type { ClientBlock, ClientBlockCreateRequest } from './api/clientBlockTypes';

/** Backend field names the block form can show errors for. */
export const CLIENT_BLOCK_FORM_FIELD_NAMES = ['visitorSessionId', 'ipAddress', 'reason', 'expiresAt'] as const;

export type ClientBlockTargetKind = 'visitorSession' | 'ipAddress';

const HOUR_MILLISECONDS = 60 * 60 * 1000;
export const MAXIMUM_REASON_LENGTH = 500;
const MAXIMUM_IPV6_LENGTH = 45;

export const BLOCK_DURATION_OPTIONS = [
  { value: 'never', label: 'Never (until lifted)', durationMilliseconds: null },
  { value: '1h', label: '1 hour', durationMilliseconds: HOUR_MILLISECONDS },
  { value: '24h', label: '24 hours', durationMilliseconds: 24 * HOUR_MILLISECONDS },
  { value: '7d', label: '7 days', durationMilliseconds: 7 * 24 * HOUR_MILLISECONDS },
  { value: '30d', label: '30 days', durationMilliseconds: 30 * 24 * HOUR_MILLISECONDS },
  { value: 'custom', label: 'At a chosen time', durationMilliseconds: null },
] as const;
export type BlockDurationChoice = (typeof BLOCK_DURATION_OPTIONS)[number]['value'];

export interface ClientBlockFormValues {
  targetKind: ClientBlockTargetKind;
  visitorSessionId: string;
  ipAddress: string;
  reason: string;
  durationChoice: BlockDurationChoice;
  /** `datetime-local` input value, used when `durationChoice` is `custom`. */
  customExpiresAt: string;
}

export function emptyClientBlockFormValues(initialVisitorSessionId?: string): ClientBlockFormValues {
  return {
    targetKind: initialVisitorSessionId === undefined ? 'ipAddress' : 'visitorSession',
    visitorSessionId: initialVisitorSessionId ?? '',
    ipAddress: '',
    reason: '',
    durationChoice: '24h',
    customExpiresAt: '',
  };
}

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_PATTERN = /^[0-9a-f:.]+$/i;

/** A light check before the server's strict one: dotted IPv4, or hex groups with colons for IPv6. */
export function looksLikeIpAddress(text: string): boolean {
  const candidate = text.trim();
  if (IPV4_PATTERN.test(candidate)) return true;
  return candidate.includes(':') && IPV6_PATTERN.test(candidate) && candidate.length <= MAXIMUM_IPV6_LENGTH;
}

/** The block's end as an ISO string, `null` for indefinite, or `undefined` when it cannot be read. */
export function resolveExpiresAt(
  values: ClientBlockFormValues,
  nowEpochMilliseconds: number,
): string | null | undefined {
  if (values.durationChoice === 'never') return null;
  if (values.durationChoice === 'custom') {
    const customEpochMilliseconds = new Date(values.customExpiresAt).getTime();
    return Number.isNaN(customEpochMilliseconds) ? undefined : new Date(customEpochMilliseconds).toISOString();
  }
  const option = BLOCK_DURATION_OPTIONS.find((durationOption) => durationOption.value === values.durationChoice);
  return new Date(nowEpochMilliseconds + (option?.durationMilliseconds ?? 0)).toISOString();
}

export function validateClientBlockForm(
  values: ClientBlockFormValues,
  nowEpochMilliseconds: number,
): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {};
  if (values.targetKind === 'visitorSession' && !isUuid(values.visitorSessionId)) {
    fieldErrors.visitorSessionId = 'Paste the full visitor session id (a UUID) from a conversation.';
  }
  if (values.targetKind === 'ipAddress' && !looksLikeIpAddress(values.ipAddress)) {
    fieldErrors.ipAddress = 'Enter an IPv4 address such as 203.0.113.7 or an IPv6 address.';
  }
  const reason = values.reason.trim();
  if (reason.length === 0 || reason.length > MAXIMUM_REASON_LENGTH) {
    fieldErrors.reason = `Say why, in 1–${MAXIMUM_REASON_LENGTH} characters.`;
  }
  const expiresAt = resolveExpiresAt(values, nowEpochMilliseconds);
  if (expiresAt === undefined) fieldErrors.expiresAt = 'Choose a date and time.';
  else if (expiresAt !== null && Date.parse(expiresAt) <= nowEpochMilliseconds) {
    fieldErrors.expiresAt = 'Choose a time in the future.';
  }
  return fieldErrors;
}

export function toClientBlockCreateRequest(
  values: ClientBlockFormValues,
  nowEpochMilliseconds: number,
): ClientBlockCreateRequest {
  const target =
    values.targetKind === 'visitorSession'
      ? { visitorSessionId: values.visitorSessionId.trim() }
      : { ipAddress: values.ipAddress.trim() };
  return { ...target, reason: values.reason.trim(), expiresAt: resolveExpiresAt(values, nowEpochMilliseconds) ?? null };
}

/** What a block matches; the service stores only keyed hashes, never the address itself. */
export function describeBlockTarget(block: Pick<ClientBlock, 'ipHash' | 'fingerprintHash'>): string {
  if (block.ipHash !== null && block.fingerprintHash !== null) return 'Network address and device';
  if (block.fingerprintHash !== null) return 'Device';
  return 'Network address';
}

export function clientBlockState(
  block: Pick<ClientBlock, 'expiresAt'>,
  nowEpochMilliseconds: number,
): { state: PlacardState; label: string } {
  if (block.expiresAt === null) return { state: 'ready', label: 'In force, no end' };
  return Date.parse(block.expiresAt) > nowEpochMilliseconds
    ? { state: 'ready', label: 'In force' }
    : { state: 'stopped', label: 'Expired' };
}
