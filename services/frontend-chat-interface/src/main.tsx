import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-bengali';
import '@fontsource-variable/jetbrains-mono';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import './i18n/i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { appConfig } from './config/appConfig';
import { applyBrandAccent, initializeTheme } from './features/theme/themePreference';

initializeTheme();
applyBrandAccent(appConfig.brandAccent);
document.title = appConfig.botName;

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
