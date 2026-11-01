import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { SignedAssetUrls } from '../../assets/signed-asset-urls.js';
import { ChatbotSettingsService } from '../../chatbot-settings/chatbot-settings.service.js';
import type { CitationPreviewView } from '../conversations/public-chat.schemas.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import { MessageCitationsRepository } from '../persistence/message-citations.repository.js';
import { presentCitation } from '../turns/citation-assembler.js';

const PREVIEW_URL_LIFETIME_SECONDS = 5 * 60;

/** The page image (and crop) behind a citation, for the visitor's source viewer. */
@Injectable()
export class CitationPreviewService {
  constructor(
    private readonly messageCitationsRepository: MessageCitationsRepository,
    private readonly signedAssetUrls: SignedAssetUrls,
    private readonly chatbotSettings: ChatbotSettingsService,
  ) {}

  /** Answers 404 for someone else's citation, and for every citation while sources are hidden. */
  async describe(visitor: VisitorPrincipal, citationId: string): Promise<CitationPreviewView> {
    const [found, settings] = await Promise.all([
      this.messageCitationsRepository.findWithOwner(citationId),
      this.chatbotSettings.getActive(),
    ]);
    if (!settings.showSources || found?.visitorSessionId !== visitor.visitorSessionId) {
      throw new ApplicationError(404, 'not_found', 'No citation has this id.');
    }
    const { citation } = found;
    return {
      documentTitle: citation.documentTitle,
      page: citation.pageNumber,
      snippet: citation.snippet,
      pageImageUrl: this.signedPngUrl(citation.pageRenderStorageKey),
      cropImageUrl: this.signedPngUrl(citation.cropStorageKey),
      bbox: presentCitation(citation).bbox,
    };
  }

  private signedPngUrl(storageKey: string | null): string | null {
    if (storageKey === null) return null;
    return this.signedAssetUrls.sign(storageKey, 'image/png', PREVIEW_URL_LIFETIME_SECONDS).url;
  }
}
