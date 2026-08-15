// GLOBAL INSTALLS THE PRODUCT DISCOVERS, not a patched discoverer.
//
// `tests/test_harness.py` and `tests/test_web.py` both carry a `_fake_global_installs` that
// rebinds `build.HOSTS[host]["config_dir"]` to a lambda. ESM cannot do that — `installTargets`
// closes over the imported `configDir` — and it turns out not to be a loss. Three of the four
// hosts resolve their global config dir from an ENVIRONMENT VARIABLE, and the fourth
// (`claudeConfigDir`) is `~/.claude` flat, which a sandboxed HOME already moves. Redirecting
// those is the same fixture reached through the resolver the product actually calls, so a
// defect in DISCOVERY reddens here instead of being replaced by the test.
//
// ONE OWNER, DELIBERATELY. This lived inline in `tests/unit/web_api.test.mjs` first, and P3's
// falsifier already made the argument for moving it: a fixture with one caller is a fixture the
// next defect cannot reach. `tests/unit/resolve_out.test.mjs` exists because the aliasing
// fixture that could have caught its bug was written inline inside a test about another
// function.
//
// EVERY HOST IS POINTED SOMEWHERE INSIDE THE SANDBOX, including the ones the caller did not ask
// for. Leaving one resolved to its real location folds the developer's own install into whatever
// is being measured — an excludes snapshot picks up their real excludes, and a count assertion
// silently stops meaning anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { makeSandbox, RELOCATION_VARS } from './sandbox.mjs';

export const ALL_HOSTS = ['claude', 'bob', 'copilot', 'opencode'];

const ENV_FOR = {
  bob: 'BOB_CONFIG_DIR',
  copilot: 'COPILOT_CONFIG_DIR',
  opencode: 'OPENCODE_CONFIG_DIR',
};

/**
 * Run `fn({ tmp, cfgs })` with a global install seeded for each host in `hosts` and none for the
 * rest. `cfgs` maps host -> its config dir.
 *
 * `claude` is the odd one: its dir is `~/.claude` with no relocation variable, so it rides the
 * caller's sandboxed HOME and is REMOVED on the way out rather than being redirected.
 */
export function withGlobalInstalls(hosts, fn) {
  const sb = makeSandbox();
  const saved = {};
  for (const v of RELOCATION_VARS) saved[v] = process.env[v];
  const claudeDir = path.join(os.homedir(), '.claude');
  const claudePreexisting = fs.existsSync(claudeDir);

  try {
    for (const [host, envVar] of Object.entries(ENV_FOR)) {
      process.env[envVar] = path.join(sb.path, `${host}-none`);
    }

    const cfgs = {};
    for (const host of hosts) {
      const cfg = host === 'claude' ? claudeDir : path.join(sb.path, `${host}-cfg`);
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, '.geneseed-manifest.json'), '{"owned": []}');
      fs.writeFileSync(path.join(cfg, 'excludes.json'), '{"excludes": []}');
      if (host === 'claude') fs.writeFileSync(path.join(cfg, 'CLAUDE.md'), 'x');
      else process.env[ENV_FOR[host]] = cfg;
      cfgs[host] = cfg;
    }
    return fn({ tmp: sb.path, cfgs });
  } finally {
    // Only remove `~/.claude` if this fixture created it. A caller running inside a sandboxed
    // HOME always owns it; refusing to guess is what keeps this safe if one ever does not.
    if (!claudePreexisting) fs.rmSync(claudeDir, { recursive: true, force: true });
    for (const [v, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[v];
      else process.env[v] = val;
    }
    sb.cleanup();
  }
}
