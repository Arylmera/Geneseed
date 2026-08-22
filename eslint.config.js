import js from '@eslint/js';
import globals from 'globals';

// Flat config (ESLint 9) for the CLI half of the repo — `js/`, `bin/`, `tests/`, `adapters/`.
// `web/` has had its own config since the UI landed; this is the half that never did, and the
// gap was not theoretical: a codemod emitted 22 over-long imports and a docblock for a deleted
// function sat in `js/lib/paths.mjs` with nothing to notice either.
//
// A DEV DEPENDENCY, WHICH IS THE WHOLE REASON THIS IS ALLOWED. The zero-dependency claim this
// package makes and gates in `tests/unit/package_manifest.test.mjs` is about `dependencies`,
// `peerDependencies`, `optionalDependencies` and `bundleDependencies` — what an INSTALL pulls
// down. `devDependencies` are never fetched by `npx geneseed`, never in the published tarball's
// `files[]`, and never on the hook path that costs 14 ms per tool call. Nothing here ships.
//
// WHAT THIS DELIBERATELY DOES NOT DO: style. There is no `max-len` rule, because `main`
// already carried 57 lines over 100 columns and turning that into an error would either
// reformat prose nobody asked to touch or be disabled on day one. Width stays a convention.
// This config hunts for things that are WRONG — an undefined name, a binding nothing reads,
// a promise nobody awaits — which is the half a reader cannot check by eye.
export default [
  {
    ignores: ['node_modules/', 'web/', 'Harness/', 'notebook/', 'tests/__snapshots__/',
      'src/skills/*/scripts/', '.claude/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // An unused binding after a module split is a leftover import or a function whose last
      // caller went with the move — the exact residue P3 could have left behind.
      // `ignoreRestSiblings` is not laxity: `const { before, ...fresh } = cell` in
      // `tests/golden.mjs` names `before` precisely to LEAVE IT OUT of `fresh`, so the binding
      // being unread is the whole mechanism. `args: after-used` keeps an exported function's
      // signature honest — a trailing parameter nothing reads is still part of its contract.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        args: 'after-used',
      }],

      // OFF, AND THIS ONE IS THE RULE BEING WRONG RATHER THAN THE CODE. Every hit is a
      // control character that is the POINT: `\x1c-\x1f` is CPython's whitespace class, which
      // `WHITESPACE` in `js/lib/text.mjs` reproduces exactly and a frozen corpus compares byte
      // for byte, and `\x00` is a NUL check on bytes read from disk. There is no spelling of
      // these that satisfies the rule and stays correct.
      'no-control-regex': 'off',

      // OFF. Every hit is the same shape — `let x = null; try { x = f(); } catch { … }` — where
      // the initializer states the fallback type at the declaration instead of leaving a
      // `let x;` whose value is `undefined` until you have read the whole block. That is a
      // deliberate idiom here, it appears 13 times, and "fixing" it trades a documented
      // default for an implicit one.
      'no-useless-assignment': 'off',
    },
  },
  {
    // The OpenCode plugins and workflow runtime ship INTO somebody else's process, where the
    // contract is that a plugin never throws into the host session. All eleven empty blocks in
    // this tree are `catch {}` around a best-effort read or unlink — the swallow IS the
    // behaviour. Exempted here rather than repo-wide, so an accidental empty catch in `js/`
    // still fails.
    files: ['adapters/**/*.js'],
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
