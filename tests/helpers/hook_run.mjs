// `bin/geneseed-hook.mjs` DRIVEN AS THE CHILD PROCESS IT REALLY IS, with stdin from a seeded
// file on fd 0.
//
// P5i's finding: faking a TTY or a pipe in process is where this kind of test goes wrong, and on
// Windows a redirected stdin still reads as a TTY to the reference. `excludes_guard.test.mjs`
// established the shape; `hook_gates.test.mjs` and `hook_done.test.mjs` copied it, so it lives
// here now. Low-level on purpose: each caller builds its own argv and spawn options and reads
// the raw `spawnSync` result, so no assertion had to change shape to share it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../../js/build/source.mjs';
import { makeSandbox } from './sandbox.mjs';

/** `node bin/geneseed-hook.mjs ...args` with `stdin` on fd 0; `opts` go to `spawnSync`. */
export function spawnHook(args, stdin = '', opts = {}) {
  const sb = makeSandbox();
  try {
    const inFile = path.join(sb.path, 'stdin.json');
    fs.writeFileSync(inFile, stdin);
    const fd = fs.openSync(inFile, 'r');
    try {
      return spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), ...args],
        { encoding: 'utf8', windowsHide: true, ...opts, stdio: [fd, 'pipe', 'pipe'] });
    } finally { fs.closeSync(fd); }
  } finally { sb.cleanup(); }
}
