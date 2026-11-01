import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, type ButtonVariant } from '@/shared/ui/Button';
import { useToast } from '@/shared/ui/toastContext';

const COPIED_FEEDBACK_MILLISECONDS = 2000;

/** Copies `text` to the clipboard and says "Copied" for a moment. */
export function CopyButton({
  text,
  label,
  variant = 'primary',
}: {
  text: string;
  label: string;
  variant?: ButtonVariant;
}) {
  const { showToast } = useToast();
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (!hasCopied) return;
    const timer = setTimeout(() => setHasCopied(false), COPIED_FEEDBACK_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [hasCopied]);

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setHasCopied(true),
      () => showToast('Could not copy. Select the text and copy it by hand.', 'error'),
    );
  };

  return (
    <Button
      size="small"
      variant={variant}
      onClick={copy}
      leadingIcon={
        hasCopied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />
      }
    >
      {hasCopied ? 'Copied' : label}
    </Button>
  );
}
