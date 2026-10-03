// The Node floor: an old Node gets one sentence instead of a stack trace. The comparison is
// numeric per component — a string compare would put '22.10.0' below '22.3.0'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { belowFloor } from '../../js/lib/node-floor.mjs';
import { ROOT } from '../../js/build/source.mjs';

test('belowFloor compares versions numerically against 22.3.0', () => {
  for (const [v, want] of [
    ['22.3.0', false],
    ['22.2.9', true],
    ['22.10.0', false],
    ['20.18.1', true],
    ['24.0.0', false],
    ['v22.3.0', false],
  ]) {
    assert.equal(belowFloor(v), want, v);
  }
});

test('the floor is the first import of all three binaries', () => {
  // Linked first means evaluated first: a later import would run its body — and whatever API
  // it lacks — before the sentence.
  for (const bin of ['geneseed-cli.mjs', 'build-driver.mjs', 'geneseed-hook.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'bin', bin), 'utf8');
    const first = src.split('\n').find((l) => /^import\b/.test(l));
    assert.equal(first, "import '../js/lib/node-floor.mjs';", bin);
  }
});
