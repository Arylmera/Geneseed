#!/usr/bin/env node
/**
 * Candidate half of the pure-function corpus probe — see tests/test_pure_function_parity.py.
 *
 * Same protocol as its Python twin: a JSON job file in, one JSON document out. It calls the
 * exported functions and does nothing else — every branch it reaches is the port's own,
 * which is the only reason a probe is allowed to exist beside a byte matrix.
 */
import { readFileSync } from 'node:fs';

import {
  accentFor, defaultTheme, manifestIsClaude, statusLines, versionVerdict,
} from '../../js/status.mjs';
import { fenceFor, setupBuildArgs } from '../../js/generate.mjs';
import { cmpKey } from '../../js/diff.mjs';
import { pyCapitalize } from '../../js/installs.mjs';
import { pyLen, pyLjust } from '../../js/lib/pyfs.mjs';
import { unifiedDiff, pySplitLines } from '../../js/lib/pydiff.mjs';

const FNS = {
  version_verdict: (a) => versionVerdict(a[0], a[1]),
  status_lines: (a) => statusLines(a[0], a[1]),
  manifest_is_claude: (a) => manifestIsClaude(a[0]),
  accent_for: (a) => accentFor(a[0]),
  default_theme: () => defaultTheme(),
  py_len: (a) => pyLen(a[0]),
  py_ljust: (a) => pyLjust(a[0], a[1]),
  fence_for: (a) => fenceFor(a[0]),
  unified_diff: (a) => unifiedDiff(a[0], a[1], {
    fromfile: 'source/f', tofile: 'deployed/f', lineterm: '',
  }),
  py_split_lines: (a) => pySplitLines(a[0]),
  cmp_key: (a) => cmpKey(a[0], a[1]),
  py_capitalize: (a) => pyCapitalize(a[0]),
  setup_build_args: (a) => setupBuildArgs(...a),
};

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = job.cases.map((c) => {
  const fn = FNS[c.fn];
  if (!fn) throw new Error(`pure_probe: unknown fn '${c.fn}'`);
  return fn(c.args);
});
process.stdout.write(JSON.stringify({ results }));
