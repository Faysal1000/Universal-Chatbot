import { createInstance, type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { WidgetLanguage } from '../../element/widgetSettings';
import { bn } from './bn';
import { en } from './en';

/**
 * A private i18next instance: the host page may run i18next itself, and the widget must neither read nor change
 * its language.
 */
export function createWidgetI18n(language: WidgetLanguage): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources: { en: { translation: en }, bn: { translation: bn } },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  return instance;
}
