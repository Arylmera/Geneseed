// `context` finds the project by the payload's `cwd` on a host that sets no `$CLAUDE_PROJECT_DIR`.
//
// Bob documents no such variable; its hook payload carries `cwd`, the root workspace. The hook
// entry already parses the payload for `context` (to tell SessionStart from SubagentStart), so
// it hands the same `cwd` to `hookProjectDir`. Run through the real entry, a process per case.
//
// THE RULE, in order: `$CLAUDE_PROJECT_DIR`, else an absolute payload `cwd`, else the process
// cwd. Each case starts the hook in directory A, which holds README "ALPHA", and names
// directory B, which holds README "BRAVO", in one of the two channels.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../js/build/source.mjs';
import { homeOverrides, withSandbox } from '../helpers/sandbox.mjs';

const HOOK = path.join(ROOT, 'bin', 'geneseed-hook.mjs');

function context(home, cwd, payload, extraEnv = {}) {
  const env = { ...process.env, ...homeOverrides(home), GENESEED_ACTIVITY: 'off', ...extraEnv };
  for (const k of ['GENESEED_ROOT', 'GENESEED_LEARN_CHILD', 'GENESEED_HOOK_TAP']) delete env[k];
  if (!('CLAUDE_PROJECT_DIR' in extraEnv)) delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [HOOK, 'context', '--host', 'bob'], {
    cwd, env, input: JSON.stringify(payload), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('context reads the project from the payload cwd, after $CLAUDE_PROJECT_DIR and before the process cwd', async () => {
  await withSandbox('payload-cwd-', (tmp) => {
    const home = path.join(tmp, 'home');
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    for (const [dir, word] of [[a, 'ALPHA'], [b, 'BRAVO']]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'README.md'), `# ${word}\n\nThe ${word} project.\n`);
    }
    mkdirSync(home, { recursive: true });
    const start = { hook_event_name: 'SessionStart', session_id: 's' };

    // No variable, no payload cwd: the process cwd, as before.
    const plain = context(home, a, start);
    assert.match(plain, /ALPHA/);
    assert.doesNotMatch(plain, /BRAVO/);

    // No variable, payload cwd B: B.
    const byPayload = context(home, a, { ...start, cwd: b });
    assert.match(byPayload, /BRAVO/);
    assert.doesNotMatch(byPayload, /ALPHA/);

    // The variable names A, the payload B: the variable wins.
    const byEnv = context(home, b, { ...start, cwd: b }, { CLAUDE_PROJECT_DIR: a });
    assert.match(byEnv, /ALPHA/);
    assert.doesNotMatch(byEnv, /BRAVO/);

    // A relative payload cwd is ignored.
    const relative = context(home, a, { ...start, cwd: 'b' });
    assert.match(relative, /ALPHA/);
    assert.doesNotMatch(relative, /BRAVO/);
  });
});
