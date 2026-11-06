// Two things the CLI says on its own, driven through the real entry points. The deprecation of
// `$GENESEED_MEMORY` and `$GENESEED_HARNESS` is one line on stderr, in the CLI and never in the hook,
// whose stdout is its verdict; both variables keep working until 6.0. The `drafts` row of `status`
// is the terminal's reminder of what the fold left waiting for the user.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../js/build/source.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const clean = (home, extra = {}) => {
  const env = { ...process.env, ...homeOverrides(home), XDG_CONFIG_HOME: path.join(home, 'xdg'), ...extra };
  for (const v of ['GENESEED_MEMORY', 'GENESEED_HARNESS']) if (!(v in extra)) delete env[v];
  return env;
};
const cli = (args, env) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), ...args],
  { encoding: 'utf8', env, cwd: env.HOME, windowsHide: true, timeout: 60000 });

test('a deprecated variable warns once on stderr, keeps working, and the hook stays silent about it', () => {
  const sb = makeSandbox('cli-dep-');
  try {
    const mem = path.join(sb.path, 'store');
    fs.mkdirSync(mem);
    fs.writeFileSync(path.join(mem, 'fact.md'), '---\nname: fact\ndescription: d\n---\nbody\n');
    const warning = /deprecated, removal planned for 6\.0/g;
    const both = cli(['memory', 'list'], clean(sb.path, { GENESEED_MEMORY: mem, GENESEED_HARNESS: sb.path }));
    assert.equal(both.status, 0, both.stderr);
    assert.equal(both.stderr.match(warning)?.length, 1, both.stderr);
    assert.match(both.stderr, /\$GENESEED_MEMORY and \$GENESEED_HARNESS/);
    assert.match(both.stdout, /fact/, 'the variable still picks the store');
    assert.doesNotMatch(both.stdout, warning, 'stdout stays what a pipe reads');
    assert.doesNotMatch(cli(['version'], clean(sb.path)).stderr, warning, 'no variable, no warning');
    const hook = spawnHook(['rule-gate'], '{}', { env: clean(sb.path, { GENESEED_MEMORY: mem, GENESEED_HARNESS: sb.path }) });
    assert.equal(hook.status, 0);
    assert.equal(`${hook.stdout}${hook.stderr}`, '');
  } finally { sb.cleanup(); }
});

test('status counts what the fold left pending, and shows nothing when nothing is', () => {
  const sb = makeSandbox('cli-drafts-');
  try {
    const env = clean(sb.path);
    const row = /\bdrafts\b.*$/m;
    assert.doesNotMatch(cli(['status'], env).stdout, row);
    const ledger = path.join(sb.path, 'xdg', 'geneseed', '.fold-state.json');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, JSON.stringify({ version: 1, items: {
      a: { kind: 'rule', state: 'pending' }, b: { kind: 'rule', state: 'approved' } } }));
    const shown = cli(['status'], env);
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(row.exec(shown.stdout)?.[0] ?? '', /1 in user-rules\.draft\.md waits for your decision/);
    assert.equal(JSON.parse(cli(['status', '--json'], env).stdout).drafts_pending, 1);
  } finally { sb.cleanup(); }
});
