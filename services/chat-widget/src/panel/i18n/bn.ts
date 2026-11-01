import { chatCoreBn } from '@chat-core/i18n/locales/bn';

import type { WidgetTranslation } from './en';

export const bn: WidgetTranslation = {
  ...chatCoreBn,
  widget: {
    subtitle: 'যাচাই করা উৎস থেকে উত্তর দেয়',
    newChat: 'নতুন চ্যাট',
    close: 'চ্যাট বন্ধ করুন',
    switchLanguage: 'ইংরেজিতে দেখুন',
    otherLanguage: 'English',
    loading: 'সহকারী চালু হচ্ছে…',
    unavailable: 'এই মুহূর্তে চ্যাটে সংযোগ করা যাচ্ছে না।',
    retry: 'আবার চেষ্টা করুন',
    offline: 'আপনি অফলাইনে আছেন। সংযোগ ফিরলে বার্তা পাঠানো হবে।',
    closeSource: 'চ্যাটে ফিরে যান',
  },
  toast: {
    ...chatCoreBn.toast,
    sessionRenewed: 'আপনার সেশন নবায়ন হয়েছে, তাই আগের চ্যাটগুলো আর দেখা যাবে না।',
  },
};
