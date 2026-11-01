import { describe, expect, it } from 'vitest';

import type { SignedAssetUrls } from '../../assets/signed-asset-urls.js';
import type { ChatbotSettingsService } from '../../chatbot-settings/chatbot-settings.service.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import type { MessageCitationsRepository } from '../persistence/message-citations.repository.js';
import { CitationPreviewService } from './citation-preview.service.js';

const visitor = { visitorSessionId: 'session-1' } as unknown as VisitorPrincipal;

function previewServiceWith(showSources: boolean): CitationPreviewService {
  const citations = {
    findWithOwner: () =>
      Promise.resolve({
        visitorSessionId: 'session-1',
        citation: {
          documentTitle: 'Handbook',
          pageNumber: 2,
          snippet: 'Annual leave is 24 days.',
          pageRenderStorageKey: 'documents/d/pages/2.png',
          cropStorageKey: null,
          bbox: null,
        },
      }),
  } as unknown as MessageCitationsRepository;
  const signedAssetUrls = {
    sign: (storageKey: string) => ({ url: `https://assets.test/${storageKey}` }),
  } as unknown as SignedAssetUrls;
  const chatbotSettings = {
    getActive: () => Promise.resolve({ showSources }),
  } as unknown as ChatbotSettingsService;
  return new CitationPreviewService(citations, signedAssetUrls, chatbotSettings);
}

describe('CitationPreviewService', () => {
  it("returns the visitor's own citation while sources are shown", async () => {
    const preview = await previewServiceWith(true).describe(visitor, 'citation-1');

    expect(preview).toMatchObject({ page: 2, pageImageUrl: 'https://assets.test/documents/d/pages/2.png' });
  });

  it('answers 404 while the admin hides sources', async () => {
    await expect(previewServiceWith(false).describe(visitor, 'citation-1')).rejects.toMatchObject({
      httpStatus: 404,
      code: 'not_found',
    });
  });
});
