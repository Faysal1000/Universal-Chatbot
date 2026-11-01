import { ImagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Shown over the chat while images are dragged onto it. */
export function ImageDropOverlay() {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-canvas/85 text-accent backdrop-blur-sm">
      <ImagePlus className="size-10" aria-hidden />
      <p className="text-lg font-medium">{t('composer.dropHere')}</p>
    </div>
  );
}
