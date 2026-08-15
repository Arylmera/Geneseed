// `tests/test_harness.py`'s `WebSubcommandTests` — that the `web` verb exists, dispatches, and
// reads the flags it declares.
//
// THE REFERENCE ASSERTS THIS BY INTROSPECTION and the port cannot: its two tests check that
// `harness.cmd_web` is callable, then rebuild `main()`'s argparse parser, monkeypatch `cmd_web`
// to a capturing stub, and read back `port == 4748`, `no_browser is True`, `theme is None`. The
// argparse walk dies with the reference — and a Node twin of it would be a copy of a value
// under test anyway, since `js/cli-table.json` IS the declaration rather than a description of
// one, so parsing the table and comparing it to itself proves nothing.
//
// WHAT REPLACES IT IS BEHAVIOUR, which is strictly stronger than what the reference could
// reach. The stub the reference installs means its test never finds out whether `cmd_web` does
// anything with the port it was handed; here the verb is really run and really asked to bind a
// PARTICULAR port, so `--port` being parsed as a number, `--no-browser` being honoured, and the
// verb being wired into the dispatcher at all are one observation.
//
// This is deliberately NOT the argparse-vs-table equality that `test_cli_reference.py` owes —
// that row keeps the claim about the TABLE matching the parser while a parser still exists. The
// claim here is about the verb doing what the table says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ROOT } from '../../js/checkout.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';

const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'cli-table.json'), 'utf8'));

test('the web verb declares the flags its callers pass', () => {
  const web = TABLE.commands.find((c) => c.name === 'web');
  assert.ok(web, 'the CLI table has no `web` verb at all');
  const byName = new Map();
  for (const o of web.options) for (const n of o.names) byName.set(n, o);
  // `--daemon-internal` is in the set because `web start` re-execs itself with it, and
  // `package_manifest.test.mjs` drives an installed package through it — a rename here would
  // break the daemon silently, since the parent spawns the child by argv.
  for (const [flag, dest, isFlag] of [['--theme', 'theme', false], ['--port', 'port', false],
    ['--no-browser', 'no_browser', true], ['--daemon-internal', 'daemon_internal', true]]) {
    const o = byName.get(flag);
    assert.ok(o, `the web verb no longer declares ${flag}`);
    assert.equal(o.dest, dest, `${flag} binds ${o.dest}, not ${dest}`);
    assert.equal(o.is_flag, isFlag, `${flag} changed between a flag and a value`);
  }
});

/** A port nothing is listening on right now — asked for, rather than guessed. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('the web verb dispatches and really binds the port it was given', async () => {
  const want = await freePort();
  const sb = makeSandbox('gs-webverb-');
  const home = path.join(sb.path, 'home');
  const child = spawn(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web', '--daemon-internal',
      '--port', String(want), '--no-browser'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...homeOverrides(home) },
    });
  let buf = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the web verb never reported ready in 60s:\n${buf}`)), 60000);
      const onData = (d) => {
        buf += d;
        if (/daemon ready/.test(buf)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the web verb exited (${code}) instead of serving:\n${buf}`));
      });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    child.kill('SIGKILL');
    sb.cleanup();
  }
  // THE PORT IS THE WHOLE ASSERTION. The reference's stub could only observe that a number
  // reached a namespace; this observes that the number reached a socket, which is the part a
  // user notices when it is wrong.
  const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
  assert.ok(m, `the daemon reported ready without naming a URL:\n${buf}`);
  assert.equal(Number(m[1]), want,
    `--port ${want} was declared but the daemon bound ${m[1]} — the flag is parsed and then `
    + 'dropped, or parsed as a string and defaulted');
  // `--no-browser` is honoured by ABSENCE, which is not directly observable — but the daemon
  // announcing itself without an "opening browser" line is the reachable half, and the flag is
  // what `web start` and every cell pass.
  assert.ok(!/opening .*browser/i.test(buf), `--no-browser was ignored:\n${buf}`);
});
