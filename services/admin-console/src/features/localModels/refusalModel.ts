/**
 * Turns local-llm refusals (RFC 9457 problems with a stable `code`) into sentences an operator
 * can act on, and says which form field a refusal belongs to.
 */
import { ApiError, describeError } from '@/shared/api/httpClient';
import { formatBytes } from '@/shared/lib/format';

type RefusalFieldName = 'name' | 'model_id' | 'device';

export interface Refusal {
  message: string;
  /** The form field the refusal is about; `undefined` for a page-level message. */
  fieldName?: RefusalFieldName;
}

const DEVICE_LABELS: Partial<Record<string, string>> = { cpu: 'CPU', cuda: 'GPU' };

/** `details` of a 409 `insufficient_memory`, from `MemoryLedger.reserve` in local-llm. */
interface InsufficientMemoryDetails {
  required_bytes: Record<string, number>;
  free_bytes: Record<string, number>;
}

export function describeRefusal(error: unknown): Refusal {
  if (!(error instanceof ApiError)) return { message: describeError(error) };
  const detail = serviceDetail(error.message);
  switch (error.code) {
    case 'insufficient_memory':
      return { message: describeInsufficientMemory(error.details) ?? detail };
    case 'unsupported_model':
      return { message: `This model cannot run on local-llm: ${detail}.`, fieldName: 'model_id' };
    case 'untrusted_remote_code':
      return { message: `${detail}.`, fieldName: 'model_id' };
    case 'gpu_unavailable':
      return {
        message: 'No usable GPU: this host or this engine build has none. Choose Auto or CPU.',
        fieldName: 'device',
      };
    case 'deployment_name_taken':
      return { message: `${detail}. Choose another name.`, fieldName: 'name' };
    case 'deployment_conflict':
      return { message: detail };
    case 'system_deployment_protected':
      return { message: `${detail}. The RAG service needs it to parse documents.` };
    case 'deployment_not_found':
      return { message: 'This deployment no longer exists. Refresh the list.' };
    default:
      return { message: error.message };
  }
}

/** The service's own sentence, without the HTTP title the client prefixes ("Conflict: ..."). */
function serviceDetail(message: string): string {
  return message.replace(/^[A-Z][A-Za-z -]*: /, '');
}

/** "Not enough memory on CPU: needs 4.1 GB, 2.3 GB free." (one clause per device that was tried). */
export function describeInsufficientMemory(details: unknown): string | undefined {
  if (!isInsufficientMemoryDetails(details)) return undefined;
  const deviceClauses = Object.entries(details.required_bytes).map(([device, requiredBytes]) => {
    const freeBytes = details.free_bytes[device] ?? 0;
    return `${DEVICE_LABELS[device] ?? device}: needs ${formatBytes(requiredBytes)}, ${formatBytes(freeBytes)} free`;
  });
  if (deviceClauses.length === 0) return undefined;
  const advice = 'Unload or remove another deployment, or choose a smaller model or quantisation.';
  return `Not enough memory on ${deviceClauses.join('; on ')}. ${advice}`;
}

function isInsufficientMemoryDetails(details: unknown): details is InsufficientMemoryDetails {
  if (typeof details !== 'object' || details === null) return false;
  const { required_bytes: requiredBytes, free_bytes: freeBytes } = details as Record<string, unknown>;
  return isByteMap(requiredBytes) && isByteMap(freeBytes);
}

function isByteMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' && value !== null && Object.values(value).every((bytes) => typeof bytes === 'number')
  );
}
