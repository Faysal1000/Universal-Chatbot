import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Citation, CitationPreview } from '@chat-core/api/chatApiContract';
import { useChatController } from '@chat-core/features/chat/ChatControllerContext';
import { IconButton } from '@chat-core/shared/ui/IconButton';

import { CitationKindIcon } from './CitationKindIcon';
import { HighlightedPageImage } from './HighlightedPageImage';

type PreviewState =
  { citationId: string; status: 'ready'; preview: CitationPreview } | { citationId: string; status: 'error' };

interface SourcePreviewProps {
  citation: Citation;
  /** All citations of the answer, for previous/next navigation. */
  siblings: readonly Citation[];
  onSelect: (citation: Citation) => void;
  closeButton: ReactNode;
  /** The element naming the surrounding dialog (the chat app passes Radix's `Dialog.Title`). */
  titleAs?: ElementType;
}

/**
 * The cited passage: excerpt, page number, the page image with the cited region highlighted, and the crop when
 * available. Each embedding supplies the surrounding sheet (a Radix dialog in the app, an in-panel sheet in the
 * website widget).
 */
export function SourcePreview({
  citation,
  siblings,
  onSelect,
  closeButton,
  titleAs: Title = 'h2',
}: SourcePreviewProps) {
  const { t } = useTranslation();
  const controller = useChatController();
  const [loaded, setLoaded] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!citation.hasPreview) return;
    const abort = new AbortController();
    const citationId = citation.id;
    controller.apiClient
      .getCitationPreview(citationId, abort.signal)
      .then((preview) => setLoaded({ citationId, status: 'ready', preview }))
      .catch(() => {
        if (!abort.signal.aborted) setLoaded({ citationId, status: 'error' });
      });
    return () => abort.abort();
  }, [citation, controller]);

  const index = siblings.findIndex((c) => c.id === citation.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  // A result loaded for a different citation means this one is still loading.
  const state = loaded?.citationId === citation.id ? loaded : { status: 'loading' as const };
  const preview = state.status === 'ready' ? state.preview : null;
  const resolve = (url: string) => controller.apiClient.resolveAssetUrl(url);

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line p-4">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
          {citation.marker}
        </span>
        <div className="min-w-0 flex-1">
          <Title className="flex items-center gap-1.5 font-semibold text-ink">
            <FileText className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            <span className="truncate">{citation.documentTitle}</span>
          </Title>
          <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
            <CitationKindIcon kind={citation.kind} />
            {t('citations.pageLong', { page: citation.page })}
          </p>
        </div>
        <div className="flex items-center">
          <IconButton
            label={t('citations.previous')}
            icon={<ChevronLeft />}
            disabled={!previous}
            onClick={() => previous && onSelect(previous)}
          />
          <IconButton
            label={t('citations.next')}
            icon={<ChevronRight />}
            disabled={!next}
            onClick={() => next && onSelect(next)}
          />
          {closeButton}
        </div>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            {t('citations.excerpt')}
          </h3>
          <blockquote className="rounded-xl border-l-4 border-accent bg-surface px-4 py-3 text-[0.95rem] leading-relaxed text-ink">
            {preview?.snippet ?? citation.snippet}
          </blockquote>
        </section>

        {citation.hasPreview && state.status === 'loading' && (
          <div role="status" className="h-64 animate-pulse rounded-xl bg-surface">
            <span className="sr-only">{t('citations.loading')}</span>
          </div>
        )}
        {citation.hasPreview && state.status === 'error' && (
          <p className="text-sm text-ink-muted">{t('citations.loadFailed')}</p>
        )}

        {preview?.cropImageUrl && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              {t('citations.cropImage')}
            </h3>
            <img
              src={resolve(preview.cropImageUrl)}
              alt={t('citations.cropImage')}
              className="w-full rounded-xl border border-line"
            />
          </section>
        )}

        {preview?.pageImageUrl && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              {t('citations.pageLong', { page: preview.page })}
            </h3>
            <a
              href={resolve(preview.pageImageUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <HighlightedPageImage
                src={resolve(preview.pageImageUrl)}
                alt={t('citations.pageImage', { page: preview.page, title: preview.documentTitle })}
                highlight={preview.bbox ?? citation.bbox}
              />
            </a>
          </section>
        )}
      </div>
    </>
  );
}
