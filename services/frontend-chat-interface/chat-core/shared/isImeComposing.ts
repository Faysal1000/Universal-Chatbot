import type { KeyboardEvent } from 'react';

/** Safari's key code for the Enter that ends an IME composition. */
const IME_PROCESS_KEY_CODE = 229;

/**
 * True while an input method (e.g. a Bangla phonetic keyboard) uses the key to commit a word, so Enter must
 * not send. Safari reports the composition-ending Enter with `isComposing` false but key code 229.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE;
}
