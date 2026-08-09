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
import { descBlockProblem, isVendoredPath, validateIsVendored } from '../../js/native.mjs';
import { proseMirrorProblems, romanToInt, themesToCheck } from '../../js/doctor.mjs';
import { pyCapitalize } from '../../js/installs.mjs';
import { pyLen, pyLjust, pyWhich } from '../../js/lib/pyfs.mjs';
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
  themes_to_check: (a) => themesToCheck(...a),
  roman_to_int: (a) => romanToInt(a[0]),
  desc_block_problem: (a) => descBlockProblem(a[0]),
  // `skill_stems` is a `set` on the reference side and a `Set` here; JSON carries a list.
  prose_mirror_problems: (a) => proseMirrorProblems(a[0], a[1], a[2], new Set(a[3]), a[4]),
  is_vendored_path: (a) => isVendoredPath(a[0]),
  validate_is_vendored: (a) => validateIsVendored(a[0]),
  py_which: (a) => pyWhich(a[0], a[1]),
};

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = job.cases.map((c) => {
  const fn = FNS[c.fn];
  if (!fn) throw new Error(`pure_probe: unknown fn '${c.fn}'`);
  return fn(c.args);
});
process.stdout.write(JSON.stringify({ results }));
