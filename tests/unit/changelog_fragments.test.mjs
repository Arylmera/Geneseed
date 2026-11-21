/**
 * Changelog fragments (`tests/changelog.mjs`): the name rule, the PR gate, and the release fold.
 *
 * WHY. A PR adds `changes/<slug>.<type>.md` instead of editing CHANGELOG.md, so parallel PRs
 * never conflict on one hunk, and a feat/fix PR with no entry is caught at review, not at release
 * (6 of 19 PRs before 6.1.0 had none). Every expected value is written out below. If a rule
 * changes, change the row and the sentence above it in the same commit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { makeSandbox } from '../helpers/sandbox.mjs';
import {
  bodyProblems, checkProblems, fold, gateVerdict, owesFragment, parseName, unreleasedBody,
} from '../changelog.mjs';

test('a fragment name is <slug>.<type>.md with a Keep a Changelog type', () => {
  assert.deepEqual(parseName('memory-topic-chips.changed.md'), { slug: 'memory-topic-chips', type: 'changed' });
  assert.deepEqual(parseName('x1.security.md'), { slug: 'x1', type: 'security' });
  // An unknown type, a capital, a missing type and a non-markdown file are not fragments.
  for (const bad of ['chips.feature.md', 'Chips.added.md', 'chips.md', 'chips.added.txt', 'README.md']) {
    assert.equal(parseName(bad), null, bad);
  }
});

test('a fragment body is one or more `- ` entries and no heading', () => {
  assert.deepEqual(bodyProblems('- **Lead.** Prose.\n'), []);
  assert.deepEqual(bodyProblems('- one\n- two\n  continued\n'), []);
  assert.deepEqual(bodyProblems('\n\n'), ['is empty']);
  assert.deepEqual(bodyProblems('Prose without a bullet'), ['must start with a `- ` entry']);
  assert.deepEqual(bodyProblems('- one\n### Added\n'), ['holds a heading; the fold writes the headings']);
});

test('feat, fix, perf and any breaking PR owe a fragment; the rest do not', () => {
  for (const t of ['feat: x', 'feat(web): x', 'fix(fs): x', 'perf: x', 'refactor!: drop y', 'chore(deps)!: z']) {
    assert.equal(owesFragment(t), true, t);
  }
  // A release PR consumes fragments; deps bumps, docs, tests and CI change nothing a user reads.
  for (const t of ['chore(release): 6.1.0', 'chore(deps): bump vite', 'docs: x', 'test: x', 'ci: x',
    'refactor: x', 'build: x', 'style: x', 'revert: x', 'not conventional']) {
    assert.equal(owesFragment(t), false, t);
  }
});

test('the gate passes on a fragment, on the skip label, or on a title that owes none', () => {
  assert.equal(gateVerdict({ title: 'feat: x', added: ['changes/x.added.md'] }), null);
  assert.equal(gateVerdict({ title: 'fix: x', labels: ['no-changelog'], added: [] }), null);
  assert.equal(gateVerdict({ title: 'chore(release): 6.2.0', added: [] }), null);
  // README.md under changes/ is not a fragment, and neither is a mis-named file, so both fail.
  for (const added of [[], ['changes/README.md'], ['changes/x.feature.md'], ['CHANGELOG.md']]) {
    assert.match(gateVerdict({ title: 'feat: x', added }), /needs a changelog fragment/, added.join());
  }
});

const CL = [
  '# Changelog', '', 'Intro.', '', '## [Unreleased]', '', '## [6.1.0] — 2026-11-21', '', '### Added', '',
  '- old', '',
].join('\n');

test('fold seals the fragments under the version, by type order, and keeps [Unreleased] empty', () => {
  const frags = [
    { file: 'b.fixed.md', type: 'fixed', body: '- fix b\n' },
    { file: 'a.changed.md', type: 'changed', body: '- change a\n  wrapped\n' },
    { file: 'c.added.md', type: 'added', body: '- add c\n- add c2\n' },
  ];
  assert.equal(fold(CL, frags, '6.2.0', '2026-12-01'), [
    '# Changelog', '', 'Intro.', '', '## [Unreleased]', '', '## [6.2.0] — 2026-12-01',
    '', '### Added', '', '- add c', '- add c2',
    '', '### Changed', '', '- change a', '  wrapped',
    '', '### Fixed', '', '- fix b',
    '', '## [6.1.0] — 2026-11-21', '', '### Added', '', '- old', '',
  ].join('\n'));
});

test('fold keeps CRLF line endings when the CHANGELOG has them', () => {
  const out = fold(CL.split('\n').join('\r\n'), [{ type: 'added', body: '- x' }], '6.2.0', '2026-12-01');
  assert.equal(out.split('\r\n').length, out.split('\n').length);
});

test('fold refuses a non-empty [Unreleased], no fragments, or a version already released', () => {
  const dirty = CL.replace('## [Unreleased]\n', '## [Unreleased]\n\n- stray\n');
  assert.throws(() => fold(dirty, [{ type: 'added', body: '- x' }], '6.2.0', 'd'), /holds entries/);
  assert.throws(() => fold(CL, [], '6.2.0', 'd'), /no fragments/);
  assert.throws(() => fold(CL, [{ type: 'added', body: '- x' }], '6.1.0', 'd'), /already has a 6\.1\.0/);
});

test('unreleasedBody reads only up to the next version heading', () => {
  assert.equal(unreleasedBody(CL), '');
  assert.equal(unreleasedBody('## [Unreleased]\n\n- a\n\n## [1.0.0]\n- b\n'), '- a');
  assert.equal(unreleasedBody('# no heading\n'), null);
});

test('checkProblems names a bad fragment and entries left under [Unreleased]', () => {
  const sb = makeSandbox('changelog-');
  const root = sb.path;
  try {
    fs.mkdirSync(path.join(root, 'changes'));
    fs.writeFileSync(path.join(root, 'changes', 'README.md'), '# not folded\n');
    fs.writeFileSync(path.join(root, 'changes', 'ok.added.md'), '- fine\n');
    fs.writeFileSync(path.join(root, 'changes', 'bad.feature.md'), '- x\n');
    fs.writeFileSync(path.join(root, 'changes', 'empty.fixed.md'), '');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '## [Unreleased]\n\n- stray\n\n## [1.0.0]\n');
    assert.deepEqual(checkProblems(root), [
      'changes/bad.feature.md: not a fragment name — use <slug>.<type>.md, type one of added, changed, deprecated, removed, fixed, security',
      'changes/empty.fixed.md: is empty',
      'CHANGELOG.md: `## [Unreleased]` holds entries — move them to changes/<slug>.<type>.md',
    ]);
  } finally {
    sb.cleanup();
  }
});

test('this repository: every fragment is well-formed and [Unreleased] is empty', () => {
  assert.deepEqual(checkProblems(), []);
});
