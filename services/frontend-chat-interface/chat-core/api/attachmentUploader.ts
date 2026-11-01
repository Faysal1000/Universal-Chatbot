import { apiPaths } from './apiPaths';
import { attachmentSchema, REQUEST_ID_HEADER, type Attachment } from './chatApiContract';
import { ChatApiError, chatApiErrorFromResponse } from './chatApiError';
import { parseJsonResponse, type HttpTransport } from './httpTransport';
import type { VisitorSessionManager } from './visitorSessionManager';

export interface UploadAttachmentOptions {
  onProgress?: (fractionComplete: number) => void;
  signal?: AbortSignal;
}

interface RawUploadResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const FORWARDED_RESPONSE_HEADERS = ['Retry-After', REQUEST_ID_HEADER] as const;

/**
 * Uploads one image as multipart/form-data with progress reporting. Uses XHR because `fetch` has no upload
 * progress events; the response is then normalised into a `Response` so errors share one parsing path.
 */
export async function uploadAttachment(
  dependencies: { transport: HttpTransport; sessions: VisitorSessionManager },
  file: File,
  options: UploadAttachmentOptions = {},
): Promise<Attachment> {
  const session = await dependencies.sessions.ensureSession();
  const form = new FormData();
  form.append('file', file, file.name);

  const raw = await sendWithProgress(dependencies.transport, form, session.sessionToken, options);
  const response = new Response(raw.body, {
    status: raw.status,
    headers: { 'Content-Type': 'application/json', ...raw.headers },
  });
  if (!response.ok) {
    const error = await chatApiErrorFromResponse(response);
    // The next request renews the session; the user simply re-attaches the image.
    if (error.kind === 'session_expired') dependencies.sessions.invalidate();
    throw error;
  }
  options.onProgress?.(1);
  return parseJsonResponse(response, attachmentSchema);
}

function sendWithProgress(
  transport: HttpTransport,
  form: FormData,
  sessionToken: string,
  options: UploadAttachmentOptions,
): Promise<RawUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', transport.url(apiPaths.attachments()));
    for (const [name, value] of Object.entries(transport.defaultHeaders)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('Authorization', `Bearer ${sessionToken}`);
    xhr.setRequestHeader(REQUEST_ID_HEADER, transport.newRequestId());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const headers: Record<string, string> = {};
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = xhr.getResponseHeader(name);
        if (value) headers[name] = value;
      }
      resolve({ status: xhr.status, body: xhr.responseText, headers });
    };
    xhr.onerror = () => {
      reject(new ChatApiError('network', 'The upload failed because of a network error.'));
    };
    xhr.onabort = () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
