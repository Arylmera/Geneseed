import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Flat config (ESLint 9). Catches real bugs — bad hook usage, undefined names —
// while eslint-config-prettier turns off every stylistic rule so formatting is
// Prettier's job alone, never a source of lint noise.
export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // The Vite/React automatic JSX runtime means React need not be in scope,
      // and this codebase documents props in prose, not PropTypes.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Empty catch is a deliberate idiom here — localStorage access throws in
      // private mode and we intentionally swallow it.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Test files run under Vitest, whose globals are also injected at runtime.
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.vitest, vi: 'readonly' },
    },
  },
  prettier,
]
