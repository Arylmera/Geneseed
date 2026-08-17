#!/usr/bin/env node
/**
 * Candidate half of the `--sync-themes` corpus probe — see tests/test_maintainer_tools_parity.py.
 *
 * Same protocol as its Python twin: `<job.json> <result.json>`, the tool's own output on this
 * process's REAL stdout, the return value and the resulting file bytes in the result document.
 *
 * `withPyNewlines` is not decoration. `syncThemes` prints through a bare
 * `process.stdout.write`, exactly like the generator's other ~25 print sites, because
 * `bin/geneseed.mjs`'s `main` is what owns the translation for all of them at once. A probe
 * that called it outside that funnel would compare LF against the reference's CRLF on Windows
 * and fail every case for a reason that has nothing to do with the port.
 */
import {
  readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { syncThemes } from '../../js/themes.mjs';
import { withPyNewlines } from '../../js/lib/fs.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tmp = makeSandbox('geneseed-themes-probe-').path;
const out = {};
try {
  // Raw bytes, so the fixture lands identically on both hosts — `writeText` would translate.
  for (const [name, text] of Object.entries(job.files)) {
    writeFileSync(path.join(tmp, name), Buffer.from(text, 'utf8'));
  }
  try {
    out.changed = withPyNewlines(() => syncThemes(tmp));
    out.exit = 0;
  } catch (e) {
    if (e && e.exitCode !== undefined) {
      out.changed = null;
      out.exit = e.exitCode;
    } else {
      throw e;
    }
  }
  out.files = {};
  for (const n of readdirSync(tmp).sort()) {
    const p = path.join(tmp, n);
    if (statSync(p).isFile()) out.files[n] = readFileSync(p).toString('base64');
  }
  writeFileSync(process.argv[3], JSON.stringify(out));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
