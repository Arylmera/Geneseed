// `hostMatrixProblems` — the two hand-written host tables carry one column per HOSTS entry.
//
// Both tables are prose: nothing compiles them, so a new host (a row in `HOSTS`) ships with no
// column and nothing goes red except a reader's confusion. This gate reads the first table
// header row of each file and compares its label set against `HOSTS.map(h => HOST_LABELS[h.host])`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hostMatrixProblems } from '../../js/inspect/checks-repo.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

test('the real repo\'s host tables carry every host — no problems', () => {
  assert.deepEqual(hostMatrixProblems(), []);
});

test('a host table missing a column names the host and the file', async () => {
  await withSandbox('host-matrix-', (tmp) => {
    mkdirSync(path.join(tmp, 'docs', 'concepts'), { recursive: true });
    const matrixPath = path.join(ROOT, 'docs', 'concepts', 'host-matrix.md');
    const original = readFileSync(matrixPath, 'utf8');
    // Drop the `Bob` column from the header row only — the rest of the file (including its own
    // body rows) is irrelevant to a gate that reads only the header.
    const mangled = original.replace(
      '| Capability | OpenCode | Claude Code | Bob | OpenClaude |',
      '| Capability | OpenCode | Claude Code | OpenClaude |',
    );
    assert.notEqual(mangled, original, 'the header line this test mangles no longer matches the '
      + 'real file — update the fixture string above to match docs/concepts/host-matrix.md');
    writeFileSync(path.join(tmp, 'docs', 'concepts', 'host-matrix.md'), mangled);
    // The enforcement table must still be copied in untouched, so only the matrix file's missing
    // column is reported.
    writeFileSync(
      path.join(tmp, 'docs', 'concepts', 'enforcement-table.md'),
      readFileSync(path.join(ROOT, 'docs', 'concepts', 'enforcement-table.md'), 'utf8'),
    );
    const problems = hostMatrixProblems(tmp);
    assert.deepEqual(problems, [
      '[authoring] docs/concepts/host-matrix.md has no column for Bob',
    ]);
  });
});
