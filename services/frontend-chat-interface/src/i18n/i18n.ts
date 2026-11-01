import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { appConfig, type SupportedLanguage } from '@/config/appConfig';
import { readStoredValue, writeStoredValue } from '@/shared/safeStorage';

import { bn } from './locales/bn';
import { en } from './locales/en';

const LANGUAGE_STORAGE_KEY = 'chat.language';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'bn', nativeName: 'বাংলা' },
];

function initialLanguage(): SupportedLanguage {
  const stored = readStoredValue(LANGUAGE_STORAGE_KEY);
  if (stored === 'en' || stored === 'bn') return stored;
  if (navigator.language.toLowerCase().startsWith('bn')) return 'bn';
  return appConfig.defaultLanguage;
}

export function setLanguage(language: SupportedLanguage): void {
  writeStoredValue(LANGUAGE_STORAGE_KEY, language);
  void i18next.changeLanguage(language);
}

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18next.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});
document.documentElement.lang = i18next.language;

export { i18next };
