import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renameSync, existsSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../js/checkout.mjs';
import { cliReferenceProblems } from '../js/cli.mjs';

// The migration deletes rituals/harness.py. `doctor` must survive that as a REPORT, not a
// stack trace — it is the command someone runs to find out what is wrong.
test('an absent rituals/harness.py is reported, not thrown', () => {
  const live = path.join(ROOT, 'rituals', 'harness.py');
  const parked = `${live}.parked-by-test`;
  assert.ok(existsSync(live), 'precondition: the reference is present');
  renameSync(live, parked);
  try {
    const problems = cliReferenceProblems();
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^\[cli\] /);
    assert.doesNotMatch(problems[0], /undefined/);
  } finally {
    renameSync(parked, live);
  }
});

test('a healthy checkout reports nothing', () => {
  assert.deepEqual(cliReferenceProblems(), []);
});
