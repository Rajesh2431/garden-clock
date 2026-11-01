import globals from 'globals';

export default [
  {
    ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results', 'public'],
  },
  {
    files: ['js/**/*.js', 'tests/**/*.js', 'vite.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        __VERCEL__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
    },
  },
];
