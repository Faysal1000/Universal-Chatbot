import { ChartColumn, TextQuote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CitationKind } from '@chat-core/api/chatApiContract';

/** Marks whether a source is running text or a visual (table, chart or figure crop). */
export function CitationKindIcon({ kind }: { kind: CitationKind }) {
  const { t } = useTranslation();
  const Icon = kind === 'visual' ? ChartColumn : TextQuote;
  const label = kind === 'visual' ? t('citations.kindVisual') : t('citations.kindText');
  return <Icon className="size-3.5 shrink-0" role="img" aria-label={label} />;
}
