import javascript from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

const typeCheckedRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
};

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'playwright-report', 'test-results', 'src/contracts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [typescriptEslint.configs.strictTypeChecked, typescriptEslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: typeCheckedRules,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite(), jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // Route tables export arrays of route objects next to their lazily loaded pages.
    files: ['src/features/*/routes.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['server/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['eslint.config.js'],
    extends: [javascript.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
