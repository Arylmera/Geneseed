// ONE REAL `opencode-global` INSTALL, BUILT ONCE, FOR THE WHOLE WEB UNIT TIER.
//
// WHY THE FIXTURE EXISTS AT ALL — carried over from `tests/test_web.py`'s own module setup,
// because the reason is a property of the code and not of the runtime. A `webState()` built with
// no explicit target resolves to the MACHINE's OpenCode config dir. Without a fixture these
// tests read whatever harness the developer happens to have installed, and they fail outright on
// a machine carrying a half-removed one — manifest present, `agents/` and `skills/` gone, so
// every count asserted `> 0` reads `0`. The install is built into a sandbox home instead, once,
// and the default target follows it. Tests that need their own tree pass an explicit `target`
// and are unaffected.
//
// THE RELOCATION VARS ARE CLEARED, AND THE PYTHON DID NOT HAVE TO. The reference re-pointed the
// resolver by REPLACING the function (`_build_core._opencode_config_dir = lambda: _FIXTURE`),
// which no environment variable can defeat. The port's `opencodeConfigDir()` is honest instead:
// it reads `$OPENCODE_CONFIG_DIR` FIRST, then `$XDG_CONFIG_HOME/opencode`. `sandboxProcessHome()`
// moves the second and says nothing about the first — it clears `HOME_VARS`, and the relocation
// vars are a different list. A developer who exports `OPENCODE_CONFIG_DIR` (a documented knob
// people really do use) would have this fixture emit 135 files into their REAL install and then
// run the whole suite against it. Cleared here, restored on teardown.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELOCATION_VARS, sandboxProcessHome, restoreProcessHome } from './sandbox.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let FIXTURE = null;
let SAVED_RELOCATION = null;

/**
 * Build the shared install. Idempotent per process, so a test file may call it at module scope
 * without caring whether another import got there first.
 *
 * Returns the install's config dir — the same path `opencodeConfigDir()` now resolves to, which
 * is what makes `webState()` with no target land here.
 */
export function webFixture() {
  if (FIXTURE) return FIXTURE;

  // FIRST, and in this process. The tests below also emit IN PROCESS, and the hook-shim writer
  // targets the ENVIRONMENT's home rather than the emit's `--out` — without this the suite
  // rewrites the developer's machine-wide shim. Running it before the spawn also means the
  // child inherits the sandboxed home, `GENESEED_HOME` included.
  const home = sandboxProcessHome();

  SAVED_RELOCATION = {};
  for (const v of RELOCATION_VARS) {
    SAVED_RELOCATION[v] = process.env[v];
    delete process.env[v];
  }

  const proc = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'opencode-global', '--theme', 'neutral'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: process.env });
  if (proc.status !== 0) {
    throw new Error(`web fixture emit failed (${proc.status}):\n${proc.stdout}\n${proc.stderr}`);
  }

  const dir = path.join(home, '.config', 'opencode');
  // The fixture is the PRECONDITION of every count assertion below it. A silent miss here reads
  // downstream as "the port returns zero agents", which is a day of debugging aimed at the
  // wrong file.
  if (!fs.existsSync(path.join(dir, 'agent'))
      && !fs.existsSync(path.join(dir, 'agents'))) {
    throw new Error(`web fixture emitted no agents into ${dir}: ${fs.existsSync(dir)
      ? fs.readdirSync(dir).join(', ') : 'the directory does not exist'}`);
  }
  FIXTURE = dir;
  return FIXTURE;
}

export function webFixtureTeardown() {
  if (!FIXTURE) return;
  for (const [v, val] of Object.entries(SAVED_RELOCATION || {})) {
    if (val === undefined) delete process.env[v];
    else process.env[v] = val;
  }
  restoreProcessHome();
  FIXTURE = null;
  SAVED_RELOCATION = null;
}
