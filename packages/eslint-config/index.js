import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  'no-console': 'error',
  eqeqeq: ['error', 'smart'],
};

/** Shared flat config. Pass workspace-relative globs for node and browser sources. */
export function createConfig({ nodeFiles = [], browserFiles = [], ignores = [] } = {}) {
  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.{ts,tsx}'],
      rules: typescriptRules,
    },
    {
      files: nodeFiles,
      languageOptions: { globals: { ...globals.node } },
    },
    {
      files: browserFiles,
      languageOptions: { globals: { ...globals.browser } },
      plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...jsxA11y.flatConfigs.recommended.rules,
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: { ...globals.node } },
      rules: { 'no-console': 'off' },
    },
    prettier,
  );
}
