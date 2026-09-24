// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // examples/ is a gallery of deliberately bad/unusual input (that's the
    // point -- ghostchars is meant to flag it), not code meant to pass lint.
    ignores: ['dist/**', 'web/dist/**', 'web/node_modules/**', 'node_modules/**', 'src/generated/**', 'examples/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'esbuild.*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', Buffer: 'readonly', performance: 'readonly' },
    },
  },
);
