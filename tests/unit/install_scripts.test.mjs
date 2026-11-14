// The two install scripts (`install.cmd`, `./install`) in profile mode: they pass their
// arguments to `setup`, and with `--profile` they skip their own `link`, the console question
// and (install.cmd) the final `pause`, so a scripted run returns (install profiles, D13, D20).
//
// THE CLI THEY RUN IS INTERCEPTED. They run the real Node (`process.execPath`, through
// `$GENESEED_NODE`, which both honour) so the version probes are real, but `NODE_OPTIONS`
// preloads a module that, when the script is `bin/geneseed-cli.mjs`, records its arguments and
// exits with `$FAKE_RC` before the CLI loads. So nothing here builds, links or starts a console:
// the real `setup --profile` would write the user PATH and the Startup folder. (A fake `.cmd`
// cannot stand in for Node: `install.cmd` calls it without `call`, which never returns.)
// Each script runs on its own platform only: cmd.exe on Windows, bash elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';

const INTERCEPT = [
  "import fs from 'node:fs';",
  "if ((process.argv[1] ?? '').endsWith('geneseed-cli.mjs')) {",
  "  fs.appendFileSync(process.env.FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
  '  process.exit(Number(process.env.FAKE_RC));',
  '}',
  '',
].join('\n');

/** Run `script` (argv) with the intercepted CLI; `{ status, stdout, calls }`. */
function runInstall(argv, rc, stdin = '') {
  const sb = makeSandbox('gs-install-');
  try {
    const log = path.join(sb.path, 'calls.log');
    const hook = path.join(sb.path, 'intercept.mjs');
    fs.writeFileSync(hook, INTERCEPT);
    const env = {
      ...cellEnv(path.join(sb.path, 'home')), GENESEED_NODE: process.execPath, FAKE_LOG: log,
      FAKE_RC: String(rc), NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
    };
    const r = spawnSync(argv[0], argv.slice(1), { env, input: stdin, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    return { status: r.status, stdout: r.stdout, calls };
  } finally { sb.cleanup(); }
}

const runCmd = (args, rc, stdin) => runInstall(
  [process.env.COMSPEC || 'cmd.exe', '/d', '/c', path.join(ROOT, 'install.cmd'), ...args], rc, stdin);
const runSh = (args, rc, stdin) => runInstall(['bash', path.join(ROOT, 'install'), ...args], rc, stdin);

test('install.cmd --profile passes the flag to setup and does nothing else', { skip: !WIN }, () => {
  const r = runCmd(['--profile', 'starter'], 0);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.calls, ['setup --profile starter']);
  assert.match(r.stdout, /Done\. Open a NEW terminal/);
  assert.doesNotMatch(r.stdout, /Press any key|Open the Geneseed web console now/);
});

test('install.cmd --profile=NAME is profile mode too', { skip: !WIN }, () => {
  const r = runCmd(['--profile=starter'], 0);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.calls, ['setup --profile=starter']);
});

test('a failing install.cmd --profile returns 1 without waiting on a pause', { skip: !WIN }, () => {
  const r = runCmd(['--profile', 'starter'], 1);
  assert.equal(r.status, 1);
  assert.deepEqual(r.calls, ['setup --profile starter']);
  assert.match(r.stdout, /Install did not finish/);
  assert.doesNotMatch(r.stdout, /Press any key/);
});

test('./install --profile passes the flag to setup and does nothing else', { skip: WIN }, () => {
  const r = runSh(['--profile', 'starter'], 0);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.calls, ['setup --profile starter']);
  assert.doesNotMatch(r.stdout, /Open the Geneseed web console now/);
});

test('./install --profile=NAME is profile mode too, and a failure exits 1', { skip: WIN }, () => {
  assert.deepEqual(runSh(['--profile=starter'], 0).calls, ['setup --profile=starter']);
  const r = runSh(['--profile', 'starter'], 1);
  assert.equal(r.status, 1);
  assert.deepEqual(r.calls, ['setup --profile starter']);
});

test('./install without --profile still runs the wizard and asks about the console (D9)', { skip: WIN }, () => {
  const r = runSh([], 0, 'n\n');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.calls[0], 'setup');
  assert.ok(!r.calls.includes('home'), 'answering n still opened the console');
});
