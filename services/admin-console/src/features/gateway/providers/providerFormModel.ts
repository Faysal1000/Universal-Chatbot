import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';

import type {
  ApiProtocolName,
  ExtraHeaderInput,
  ProviderCreateRequest,
  ProviderResponse,
  ProviderUpdateRequest,
} from './api/providerTypes';
import { PROVIDER_ID_PATTERN } from './api/providerTypes';

/** One row of the extra-headers editor. */
export interface ExtraHeaderRow {
  rowId: number;
  name: string;
  /** Empty for a stored header means "keep the saved value". */
  value: string;
  /** True for headers that already exist on the server (their value is never shown). */
  isStored: boolean;
}

export interface ProviderFormValues {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiProtocol: ApiProtocolName;
  apiKey: string;
  clearApiKey: boolean;
  extraHeaders: ExtraHeaderRow[];
  requestTimeoutSeconds: string;
  maxConcurrentRequests: string;
  isEnabled: boolean;
}

/** Backend field names that the form can show inline errors for. */
export const PROVIDER_FORM_FIELD_NAMES = [
  'provider_id',
  'display_name',
  'base_url',
  'api_protocol',
  'api_key',
  'extra_headers',
  'request_timeout_seconds',
  'max_concurrent_requests',
] as const;

const DEFAULT_REQUEST_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 64;
const MAXIMUM_REQUEST_TIMEOUT_SECONDS = 1800;
const MAXIMUM_CONCURRENT_REQUESTS = 10_000;
export const BASE_URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const RESERVED_HEADER_NAMES = new Set(['content-type', 'content-length', 'host', 'accept', 'transfer-encoding']);

let nextExtraHeaderRowId = 1;
export function createExtraHeaderRow(name = '', isStored = false): ExtraHeaderRow {
  const row = { rowId: nextExtraHeaderRowId, name, value: '', isStored };
  nextExtraHeaderRowId += 1;
  return row;
}

export function initialProviderFormValues(provider: ProviderResponse | undefined): ProviderFormValues {
  if (!provider) {
    return {
      providerId: '',
      displayName: '',
      baseUrl: '',
      apiProtocol: 'openai_chat_completions',
      apiKey: '',
      clearApiKey: false,
      extraHeaders: [],
      requestTimeoutSeconds: String(DEFAULT_REQUEST_TIMEOUT_SECONDS),
      maxConcurrentRequests: String(DEFAULT_MAX_CONCURRENT_REQUESTS),
      isEnabled: true,
    };
  }
  return {
    providerId: provider.provider_id,
    displayName: provider.display_name,
    baseUrl: provider.base_url,
    apiProtocol: provider.api_protocol,
    apiKey: '',
    clearApiKey: false,
    extraHeaders: provider.extra_header_names.map((headerName) => createExtraHeaderRow(headerName, true)),
    requestTimeoutSeconds: String(provider.request_timeout_seconds),
    maxConcurrentRequests: String(provider.max_concurrent_requests),
    isEnabled: provider.is_enabled,
  };
}

/** Client-side checks mirroring the backend's validation, keyed by backend field name. */
export function validateProviderForm(values: ProviderFormValues, isNewProvider: boolean): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {};
  if (isNewProvider && !PROVIDER_ID_PATTERN.test(values.providerId)) {
    fieldErrors.provider_id = 'Use 1–63 lowercase letters, digits, hyphens or underscores, starting with a letter.';
  }
  if (!values.displayName.trim()) fieldErrors.display_name = 'Enter a display name.';
  if (!BASE_URL_PATTERN.test(values.baseUrl.trim())) {
    fieldErrors.base_url = 'Enter an http(s) URL such as https://api.example.com/v1.';
  }
  const timeoutSeconds = Number(values.requestTimeoutSeconds);
  if (
    !values.requestTimeoutSeconds.trim() ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > MAXIMUM_REQUEST_TIMEOUT_SECONDS
  ) {
    fieldErrors.request_timeout_seconds = 'Enter a number of seconds between 1 and 1800.';
  }
  const maxConcurrentRequests = Number(values.maxConcurrentRequests);
  if (
    !Number.isInteger(maxConcurrentRequests) ||
    maxConcurrentRequests < 1 ||
    maxConcurrentRequests > MAXIMUM_CONCURRENT_REQUESTS
  ) {
    fieldErrors.max_concurrent_requests = 'Enter a whole number between 1 and 10,000.';
  }
  const extraHeadersError = validateExtraHeaders(values.extraHeaders);
  if (extraHeadersError) fieldErrors.extra_headers = extraHeadersError;
  return fieldErrors;
}

function validateExtraHeaders(rows: readonly ExtraHeaderRow[]): string | undefined {
  const seenNames = new Set<string>();
  for (const row of rows) {
    const headerName = row.name.trim();
    if (!HEADER_NAME_PATTERN.test(headerName)) return `"${headerName || '(empty)'}" is not a valid header name.`;
    if (RESERVED_HEADER_NAMES.has(headerName.toLowerCase())) {
      return `${headerName} is set by the gateway and cannot be overridden.`;
    }
    if (seenNames.has(headerName.toLowerCase())) return `${headerName} is listed twice.`;
    seenNames.add(headerName.toLowerCase());
    if (!row.isStored && row.value === '') return `Enter a value for ${headerName}.`;
  }
  return undefined;
}

function toExtraHeaderInputs(rows: readonly ExtraHeaderRow[]): ExtraHeaderInput[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    value: row.isStored && row.value === '' ? null : row.value,
  }));
}

export function toProviderCreateRequest(values: ProviderFormValues): ProviderCreateRequest {
  return {
    provider_id: values.providerId,
    display_name: values.displayName.trim(),
    base_url: values.baseUrl.trim(),
    api_protocol: values.apiProtocol,
    api_key: values.apiKey === '' ? null : values.apiKey,
    extra_headers: toExtraHeaderInputs(values.extraHeaders),
    is_enabled: values.isEnabled,
    request_timeout_seconds: Number(values.requestTimeoutSeconds),
    max_concurrent_requests: Number(values.maxConcurrentRequests),
  };
}

/**
 * Builds a PATCH body. The API key is sent only when a new one was typed (or cleared);
 * extra headers are sent only when the list changed or a new value was entered.
 */
export function toProviderUpdateRequest(values: ProviderFormValues, provider: ProviderResponse): ProviderUpdateRequest {
  const request: ProviderUpdateRequest = {
    display_name: values.displayName.trim(),
    base_url: values.baseUrl.trim(),
    api_protocol: values.apiProtocol,
    is_enabled: values.isEnabled,
    request_timeout_seconds: Number(values.requestTimeoutSeconds),
    max_concurrent_requests: Number(values.maxConcurrentRequests),
  };
  if (values.clearApiKey) request.clear_api_key = true;
  else if (values.apiKey !== '') request.api_key = values.apiKey;

  const submittedHeaderNames = values.extraHeaders.map((row) => row.name.trim());
  const headerNamesChanged =
    submittedHeaderNames.length !== provider.extra_header_names.length ||
    submittedHeaderNames.some((headerName, index) => headerName !== provider.extra_header_names[index]);
  const anyHeaderValueEntered = values.extraHeaders.some((row) => row.value !== '');
  if (headerNamesChanged || anyHeaderValueEntered) request.extra_headers = toExtraHeaderInputs(values.extraHeaders);
  return request;
}
