import { ApiError, toApiError } from './httpClient';

function responseWithStatus(status: number): Response {
  return new Response(null, { status });
}

describe('toApiError', () => {
  it('reads FastAPI validation lists', () => {
    const error = toApiError(responseWithStatus(422), {
      detail: [{ loc: ['body', 'steps', 0, 'max_attempts'], msg: 'must be at most 10' }],
    });

    expect(error.message).toBe('steps.0.max_attempts: must be at most 10');
    expect(error.validationErrors).toHaveLength(1);
  });

  it('joins a problem title and detail and keeps its code and details', () => {
    const error = toApiError(responseWithStatus(409), {
      title: 'Insufficient memory',
      detail: 'needs 4 GB',
      code: 'insufficient_memory',
      details: { required_bytes: { cpu: 4 } },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Insufficient memory: needs 4 GB');
    expect(error.code).toBe('insufficient_memory');
    expect(error.details).toEqual({ required_bytes: { cpu: 4 } });
  });

  it('keeps top-level problem fields reachable when there is no details object', () => {
    const error = toApiError(responseWithStatus(409), {
      title: 'Duplicate document',
      code: 'duplicate_document',
      existingDocumentId: 'doc-1',
    });

    expect(error.details).toMatchObject({ existingDocumentId: 'doc-1' });
  });

  it("maps rag's field errors onto validation errors", () => {
    const error = toApiError(responseWithStatus(422), {
      title: 'Invalid request',
      errors: [{ field: 'minSimilarity', message: 'must be at most 1' }],
    });

    expect(error.validationErrors).toEqual([{ loc: ['body', 'minSimilarity'], msg: 'must be at most 1' }]);
  });

  it('falls back to a status message without a body', () => {
    expect(toApiError(responseWithStatus(502), undefined).message).toBe(
      'The service behind this page is not reachable.',
    );
  });
});
