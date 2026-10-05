#!/usr/bin/env node
/**
 * The pure-function probe: a JSON job file in, one JSON document out. It calls the exported
 * functions and does nothing else — every branch it reaches is the product's own, which is the
 * only reason a probe is allowed to exist beside a byte matrix.
 *
 * Its drivers are `tests/unit/wizard.test.mjs` (the stdin readers, the wizard, the summary rows)
 * and `tests/unit/web_first.test.mjs` (`web_first_ok`). A row no test drives is not kept here:
 * the former Python parity suite's other rows went with it.
 */
import { readFileSync } from 'node:fs';

import { installedDefaults } from '../../js/hosts/installs.mjs';
import { collectSetupLines, setupSummaryLines } from '../../js/maintain/setup.mjs';
import { ask, askChoice, confirm, promptLine } from '../../js/lib/prompt.mjs';
import { webFirstOk } from '../../js/ui/menu.mjs';

const FNS = {
  installed_defaults: () => installedDefaults(),
  setup_summary_lines: (a) => setupSummaryLines(...a),
  // The stdin readers. Their PROMPTS are stdout, which is why the wizard job is compared as
  // raw bytes rather than through a JSON parse — see the test's docstring.
  ask: (a) => ask(...a),
  prompt_line: (a) => promptLine(a[0]),
  confirm: (a) => confirm(...a),
  ask_choice: (a) => askChoice(a[0], a[1], a[2]),
  collect_setup_lines: () => collectSetupLines(),
  // `args[0]` FAKES `isTTY`, because a probe's stdin is a seeded file and every branch past the
  // isatty test would otherwise be dead — the one input no cell and no ordinary job can vary.
  // `process.stdin.isTTY` is a plain property; it is put back afterwards.
  web_first_ok: (a) => {
    const real = process.stdin.isTTY;
    process.stdin.isTTY = a[0];
    try { return webFirstOk(); } finally { process.stdin.isTTY = real; }
  },
};

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = job.cases.map((c) => {
  const fn = FNS[c.fn];
  if (!fn) throw new Error(`pure_probe: unknown fn '${c.fn}'`);
  return fn(c.args);
});
// Plain `JSON.stringify` (`,`/`:` separators, no ASCII escaping): the wizard job reads the
// probe's whole stdout as bytes, so the serialiser is part of what it sees. `jsonDumpsCompact`
// is not used because it REFUSES a bare number by design, and some of these rows return one.
process.stdout.write(JSON.stringify({ results }));
