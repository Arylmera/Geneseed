// The three doctor arms that hold what the docs say about a host to one place each
// (`js/inspect/checks-repo.mjs`, beside `hostMatrixProblems`):
//
//   bobBlockProblems    the Bob column of docs/concepts/enforcement-table.md says "block" exactly
//                       for the rules in `BLOCK_RULES` (js/hosts/hooks.mjs).
//   strayClaimProblems  a verified/unverified claim sits only under `## What is verified` in
//                       docs/concepts/host-matrix.md.
//   localNoteProblems   no file cites docs/reviews/, which is gitignored.
//
// Every expectation below is written out. Each fixture is a temp root holding only the files the
// row is about, so a row cannot pass because of something else in the real tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { bobBlockProblems, localNoteProblems, strayClaimProblems } from '../../js/inspect/checks-repo.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

const put = (root, rel, text) => {
  const p = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};

test('the real repo passes all three arms', () => {
  assert.deepEqual(bobBlockProblems(), []);
  assert.deepEqual(strayClaimProblems(), []);
  assert.deepEqual(localNoteProblems(), []);
});

// ---------------------------------------------------------------------------------------------
// bobBlockProblems
// ---------------------------------------------------------------------------------------------

const TABLE = 'docs/concepts/enforcement-table.md';
const realTable = () => readFileSync(path.join(ROOT, ...TABLE.split('/')), 'utf8');
const hooksWith = (ids) => `const BLOCK_RULES = new Set([${ids.map((i) => `'${i}'`).join(', ')}]);\n`;

// THE RULE: a rule's Bob cell starts with the word "block" if and only if its ledger key is in
// BLOCK_RULES. The ledger key is the canon label of the rule: law I -> law-1, law IV -> law-4,
// `process 1` -> process-1, `rigor 5` -> rigor-5, `ops 2` -> ops-2. Today's set is those five;
// `consent-before-push` (process-5) and `verify-before-asserting` (law-3) are not in it, and
// their cells say "log only" and "not judged".
const FIVE = ['law-1', 'law-4', 'rigor-5', 'ops-2', 'process-1'];

test('the real table agrees with a BLOCK_RULES of exactly today\'s five ids', async () => {
  await withSandbox('bob-block-', (tmp) => {
    put(tmp, TABLE, realTable());
    put(tmp, 'js/hosts/hooks.mjs', hooksWith(FIVE));
    assert.deepEqual(bobBlockProblems(tmp), []);
  });
});

test('a rule dropped from BLOCK_RULES while its cell still says block is named', async () => {
  await withSandbox('bob-block-', (tmp) => {
    put(tmp, TABLE, realTable());
    put(tmp, 'js/hosts/hooks.mjs', hooksWith(['law-1', 'law-4', 'rigor-5', 'ops-2']));
    assert.deepEqual(bobBlockProblems(tmp), [
      '[authoring] docs/concepts/enforcement-table.md: the Bob cell of `persist-insight` says '
      + '"block", but BLOCK_RULES (js/hosts/hooks.mjs) does not have process-1 — the table is the '
      + 'one statement of what Bob refuses',
    ]);
  });
});

test('a rule added to BLOCK_RULES while its cell says something else is named', async () => {
  await withSandbox('bob-block-', (tmp) => {
    put(tmp, TABLE, realTable());
    put(tmp, 'js/hosts/hooks.mjs', hooksWith([...FIVE, 'process-5']));
    assert.deepEqual(bobBlockProblems(tmp), [
      '[authoring] docs/concepts/enforcement-table.md: the Bob cell of `consent-before-push` does '
      + 'not say "block", but BLOCK_RULES (js/hosts/hooks.mjs) has process-5 — the table is the '
      + 'one statement of what Bob refuses',
    ]);
  });
});

test('a hooks.mjs without the one-line BLOCK_RULES declaration is its own problem', async () => {
  await withSandbox('bob-block-', (tmp) => {
    put(tmp, TABLE, realTable());
    put(tmp, 'js/hosts/hooks.mjs', 'const BLOCKED = new Set();\n');
    assert.deepEqual(bobBlockProblems(tmp), [
      '[authoring] js/hosts/hooks.mjs no longer declares `const BLOCK_RULES = new Set([…])` on one '
      + 'line — the Bob block check (js/inspect/checks-repo.mjs) reads that line',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// strayClaimProblems
// ---------------------------------------------------------------------------------------------

const MATRIX = 'docs/concepts/host-matrix.md';
const BLOCK = '# Hosts\n\n## What is verified\n\nBob: unverified live.\n\n## After\n\n';

// THE RULE: a line fails when it holds "verified live" (so "unverified live" too), or "not",
// optionally "yet", optionally "been", then "run", "verified" or "tested", then "against" —
// in any letter case. Each row: the line, and the matched words the message quotes (null: the
// line passes).
const PHRASES = [
  ['Unverified live (no Bob install).', 'Unverified live'],
  ['It was never verified live.', 'verified live'],
  ['It has not been run against an installed host yet.', 'not been run against'],
  ['Support has not yet been verified against a live install.', 'not yet been verified against'],
  ['The wiring has not been tested against a live Bob.', 'not been tested against'],
  ['Not verified against 2.2.3.', 'Not verified against'],
  ['See What is verified.', null],
  ['The sub-agent deferral is unverified.', null],
  ['Not yet observed live on either host.', null],
  ['The value is verified before it is written.', null],
];

test('each phrase, in a page outside the block', async () => {
  for (const [line, quoted] of PHRASES) {
    await withSandbox('stray-claim-', (tmp) => {
      put(tmp, MATRIX, BLOCK);
      put(tmp, 'docs/guides/page.md', `first line\n${line}\n`);
      assert.deepEqual(strayClaimProblems(tmp), quoted === null ? [] : [
        `[authoring] docs/guides/page.md:2 says "${quoted}" — what is verified about a host is said `
        + 'only under `## What is verified` in docs/concepts/host-matrix.md; link there instead',
      ], line);
    });
  }
});

// THE RULE: the block runs from its heading to the next `## ` heading. Inside it the words are
// allowed; in the same file after it they are not. CHANGELOG.md and docs/adr/ are dated records
// and are never read; a file that is not Markdown is not this arm's business.
test('the block, the same file after the block, and the exempt files', async () => {
  await withSandbox('stray-claim-', (tmp) => {
    put(tmp, MATRIX, `${BLOCK}OpenClaude: unverified live.\n`);
    put(tmp, 'CHANGELOG.md', 'Unverified live.\n');
    put(tmp, 'docs/adr/0001-x.md', 'never verified live\n');
    put(tmp, 'js/hosts/a.mjs', '// unverified live\n');
    assert.deepEqual(strayClaimProblems(tmp), [
      '[authoring] docs/concepts/host-matrix.md:9 says "unverified live" — what is verified about a '
      + 'host is said only under `## What is verified` in docs/concepts/host-matrix.md; link there instead',
    ]);
  });
});

test('a host matrix with no What-is-verified heading is a problem', async () => {
  await withSandbox('stray-claim-', (tmp) => {
    put(tmp, MATRIX, '# Hosts\n\n## What each host automates\n');
    assert.deepEqual(strayClaimProblems(tmp), [
      '[authoring] docs/concepts/host-matrix.md has no `## What is verified` section — the one '
      + 'place that says what was checked against each host',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// localNoteProblems
// ---------------------------------------------------------------------------------------------

// THE RULE: a line fails when it names the directory `docs/reviews/` or one of the three note
// files, `bob-verdict.md`, `bob-docs.md`, `bob-code.md`, in any text file. Exempt: CHANGELOG.md
// (a dated record), tests/unit/package_manifest.test.mjs (it records that the directory never
// ships), the arm's own source and this test. A real docs/reviews/ directory is not walked: it
// is the local notes themselves.
test('a citation of the local notes is named with its file and line; the exemptions hold', async () => {
  await withSandbox('local-note-', (tmp) => {
    put(tmp, 'js/hosts/a.mjs', '// fine\n// see bob-verdict.md I1\n');
    put(tmp, 'adapters/bob/README.md', 'see `docs/reviews/bob-global-injection-2026-09.md`\n');
    put(tmp, 'docs/guides/b.md', 'per bob-docs.md §6 and bob-code.md B3\nbob-notes.md is fine\n');
    put(tmp, 'CHANGELOG.md', 'added docs/reviews/\n');
    put(tmp, 'tests/unit/package_manifest.test.mjs', '// docs/reviews/ never ships\n');
    put(tmp, 'docs/reviews/bob-verdict.md', 'see bob-docs.md\n');
    const tail = ' — docs/reviews/ is gitignored, so nobody else can open it; cite the '
      + "What-is-verified block, a dated observation or the host's own docs";
    assert.deepEqual(localNoteProblems(tmp), [
      `[authoring] adapters/bob/README.md:1 cites docs/reviews/${tail}`,
      `[authoring] docs/guides/b.md:1 cites bob-docs.md${tail}`,
      `[authoring] js/hosts/a.mjs:2 cites bob-verdict.md${tail}`,
    ]);
  });
});
