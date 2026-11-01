import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@chat-core/shared/ui/IconButton';

import { GLOBAL_SHORTCUTS } from './keyboardShortcuts';

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const rows: { label: string; keys: string[] }[] = [
    { label: t('shortcuts.send'), keys: ['Enter'] },
    { label: t('shortcuts.newline'), keys: ['Shift', 'Enter'] },
    { label: t('shortcuts.editLast'), keys: ['↑'] },
    ...GLOBAL_SHORTCUTS.map((shortcut) => ({
      label: t(`shortcuts.${shortcut.action}`),
      keys: shortcut.display,
    })),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-canvas p-5 shadow-elevated"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-ink">{t('shortcuts.title')}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('shortcuts.close')} icon={<X />} tooltip={false} />
            </Dialog.Close>
          </div>
          <dl className="divide-y divide-line">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="flex gap-1">
                  {row.keys.map((key) => (
                    <kbd
                      key={key}
                      className="min-w-6 rounded-md border border-line bg-surface px-1.5 py-0.5 text-center font-sans text-xs text-ink"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
