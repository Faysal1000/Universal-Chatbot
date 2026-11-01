import { useState } from 'react';

import { Dialog } from '@/shared/ui/Dialog';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';

import type { WidgetKey } from '../api/widgetKeyTypes';
import { npmSnippet, scriptTagSnippet } from '../embedSnippetModel';
import { CopyButton } from './CopyButton';

type SnippetKind = 'npm' | 'script';

const SNIPPET_KIND_OPTIONS: readonly { value: SnippetKind; label: string }[] = [
  { value: 'npm', label: 'npm' },
  { value: 'script', label: 'Script tag' },
];

export interface EmbedCodeDialogProps {
  widgetKey: WidgetKey | null;
  onClose: () => void;
}

export function EmbedCodeDialog({ widgetKey, onClose }: EmbedCodeDialogProps) {
  return (
    <Dialog
      isOpen={widgetKey !== null}
      onClose={onClose}
      title={widgetKey ? `Embed code for ${widgetKey.name}` : 'Embed code'}
      description="Position, theme, colours and greeting are attributes the site sets."
    >
      {widgetKey ? <EmbedCode publishableKey={widgetKey.publishableKey} /> : null}
    </Dialog>
  );
}

function EmbedCode({ publishableKey }: { publishableKey: string }) {
  const [snippetKind, setSnippetKind] = useState<SnippetKind>('npm');
  const snippet = snippetKind === 'npm' ? npmSnippet(publishableKey) : scriptTagSnippet(publishableKey);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          label="Install with"
          options={SNIPPET_KIND_OPTIONS}
          value={snippetKind}
          onChange={setSnippetKind}
        />
        <CopyButton text={snippet} label="Copy code" />
      </div>
      <pre
        className="overflow-x-auto rounded-md border border-border bg-surface-raised p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-primary"
        aria-label="Embed code"
      >
        <code>{snippet}</code>
      </pre>
    </div>
  );
}
