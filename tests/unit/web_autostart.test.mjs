/**
 * Settings' Start at login: the login launcher Geneseed writes, rewrites and removes.
 *
 * EVERY WRITE LANDS IN A SANDBOXED HOME. `webFixture()` points HOME and USERPROFILE at a temp
 * folder before anything runs, and the first test refuses to go on unless `autostartFile` resolves
 * under the OS temp root. The real Startup folder and `~/Library/LaunchAgents` are never touched.
 *
 * THE FILE TEXT IS WRITTEN OUT here, not read back from `autostartText`: a test that compared the
 * writer with itself would agree with any change to it. Both platforms run on any machine, because
 * the path and the text take the platform as an argument and the path sits under the sandbox home.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  autostartFile, autostartInstall, autostartPathProblem, autostartRemove, autostartState,
  autostartText, transientRoot,
} from '../../js/hosts/shim.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { makeHandler } from '../../js/web/handler.mjs';
import { webState } from '../../js/web/state.mjs';
import { TMP_ROOT } from '../helpers/sandbox.mjs';
import { ROOT, webFixture, webFixtureTeardown } from '../helpers/web_fixture.mjs';

webFixture();
after(webFixtureTeardown);

const EXE = process.execPath;
const ENTRY = path.join(ROOT, 'bin', 'geneseed-cli.mjs');
const PLATFORMS = ['win32', 'darwin'];

/** What an install writes on Windows for `exe` and `entry`: CRLF, Node called directly. */
const vbs = (exe, entry) => "' geneseed-web.vbs: start the Geneseed web console at login (hidden, no browser).\r\n"
  + "' GENESEED_AUTOSTART: written by Geneseed (Settings, Start at login), which may update or remove it.\r\n"
  + `CreateObject("WScript.Shell").Run """${exe}"" ""${entry}"" web start --no-browser", 0, False\r\n`;

/** What an install writes on macOS: RunAtLoad, no KeepAlive, LF. */
const plist = (exe, entry) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- GENESEED_AUTOSTART: written by Geneseed (Settings, Start at login), which may update or remove it. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.geneseed.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exe}</string>
    <string>${entry}</string>
    <string>web</string>
    <string>start</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
const EXPECTED = { win32: vbs(EXE, ENTRY), darwin: plist(EXE, ENTRY) };

const read = (f) => readFileSync(f, 'utf8');
/** A state as the row receives it: the file, its state, the checkout it runs, and whether that copy may go. */
const S = (file, state) => ({ file, state, root: ROOT, transient: transientRoot(ROOT) });
const clear = () => { for (const p of PLATFORMS) rmSync(path.dirname(autostartFile(p)), { recursive: true, force: true }); };

test('the launcher paths are inside the sandbox home, never the real one', () => {
  for (const p of PLATFORMS) {
    assert.ok(autostartFile(p).startsWith(TMP_ROOT),
      `${p}: ${autostartFile(p)} is outside the temp root — every write below would hit the real machine`);
  }
  assert.equal(autostartFile('linux'), null);
  assert.equal(autostartState('linux'), null);
});

test('the text escapes each platform\'s hazards', () => {
  // A `"` doubles inside a VBS string; `& < >` become entities in a plist. The text builder
  // does not refuse a `%`: `autostartPathProblem` does, before any text is built.
  assert.equal(autostartText('win32', 'C:\\a "b"\\node.exe', 'C:\\x%y%&z\\cli.mjs'),
    vbs('C:\\a ""b""\\node.exe', 'C:\\x%y%&z\\cli.mjs'));
  assert.equal(autostartText('darwin', '/a&b/node', '/<x>/cli.mjs'),
    plist('/a&amp;b/node', '/&lt;x&gt;/cli.mjs'));
  assert.equal(autostartText('linux'), null);
});

test('install writes the written-out text, and a second install changes nothing', () => {
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    assert.deepEqual(autostartState(p), S(f, 'absent'));
    assert.deepEqual(autostartInstall(p), { ok: true, autostart: S(f, 'ours') });
    assert.equal(read(f), EXPECTED[p]);
    assert.deepEqual(autostartInstall(p), { ok: true, autostart: S(f, 'ours') });
    assert.equal(read(f), EXPECTED[p], `${p}: a second install changed the file`);
  }
});

test('remove deletes our file, and a second remove is refused', () => {
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    autostartInstall(p);
    assert.deepEqual(autostartRemove(p), { ok: true, autostart: S(f, 'absent') });
    assert.equal(existsSync(f), false);
    assert.deepEqual(autostartRemove(p),
      { ok: false, autostart: S(f, 'absent'), error: `no login launcher at ${f}` });
  }
});

test('a hand-written file is never removed and never overwritten', () => {
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    mkdirSync(path.dirname(f), { recursive: true });
    // The guide's own template: it names Geneseed, but not the marker.
    const mine = 'CreateObject("WScript.Shell").Run "cmd /c geneseed web start --no-browser", 0, False\r\n';
    writeFileSync(f, mine);
    const refused = { ok: false, autostart: S(f, 'hand'),
      error: `${f} was not written by Geneseed, so it is left alone` };
    assert.deepEqual(autostartState(p), S(f, 'hand'));
    assert.deepEqual(autostartRemove(p), refused);
    assert.deepEqual(autostartInstall(p), refused);
    assert.equal(read(f), mine, `${p}: the hand-written file was changed`);
  }
});

test('our file from another checkout is stale, and install updates it', () => {
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    mkdirSync(path.dirname(f), { recursive: true });
    const old = p === 'win32' ? vbs(EXE, 'C:\\old\\Geneseed\\bin\\geneseed-cli.mjs')
      : plist(EXE, '/old/Geneseed/bin/geneseed-cli.mjs');
    writeFileSync(f, old);
    assert.deepEqual(autostartState(p), S(f, 'stale'));
    assert.deepEqual(autostartInstall(p), { ok: true, autostart: S(f, 'ours') });
    assert.equal(read(f), EXPECTED[p]);
  }
});

test('a path the launcher cannot hold is refused, and nothing is written', () => {
  // Checked on the two paths, not the whole text. On Windows: `%` (WshShell.Run expands
  // %VAR%) and non-ASCII (WSH reads a BOM-less .vbs as ANSI). On both: CR, LF, any control.
  clear();
  const hint = ': set it up by hand (see Start the web console at login)';
  const cases = [
    ['win32', 'C:\\Users\\Andr\u00e9\\node.exe', ENTRY,
      'the path C:\\Users\\Andr\u00e9\\node.exe has non-ASCII characters, which a .vbs cannot hold'],
    ['win32', EXE, 'C:\\%TEMP%\\cli.mjs', 'the path C:\\%TEMP%\\cli.mjs has a %, which the login script would expand'],
    ['win32', EXE, 'C:\\a\r\nb.mjs', 'the path "C:\\\\a\\r\\nb.mjs" has a control character'],
    ['darwin', '/usr/bin/no\nde', ENTRY, 'the path "/usr/bin/no\\nde" has a control character'],
    ['darwin', '/opt/n\u0007/node', ENTRY, 'the path "/opt/n\\u0007/node" has a control character'],
  ];
  for (const [p, exe, entry, why] of cases) {
    const f = autostartFile(p);
    assert.deepEqual(autostartInstall(p, exe, entry), { ok: false, autostart: S(f, 'absent'), error: why + hint });
    assert.equal(existsSync(f), false, `${p}: ${why} was written anyway`);
  }
  // A `%` is only a Windows hazard; non-ASCII is fine in a UTF-8 plist.
  assert.equal(autostartPathProblem('darwin', '/x%y/node', '/Andr\u00e9/cli.mjs'), null);
  assert.equal(autostartPathProblem('win32', EXE, ENTRY), null);
});

test('the write goes through a temp file in the same folder, renamed over the target', () => {
  // A leftover temp of this pid makes the exclusive create fail: proof that the bytes go to the
  // temp first. The target keeps its old text, the temp is cleaned up, and the next try works.
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    autostartInstall(p);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, 'leftover');
    const r = autostartInstall(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /\(EEXIST: /);
    assert.equal(existsSync(tmp), false, `${p}: the temp file was left behind`);
    assert.equal(read(f), EXPECTED[p]);
    assert.deepEqual(autostartInstall(p), { ok: true, autostart: S(f, 'ours') });
    assert.deepEqual(readdirSync(path.dirname(f)), [path.basename(f)], `${p}: a temp file remains`);
  }
});

test('the marker counts only on its own line: line 2 of the VBS, line 3 of the plist', () => {
  clear();
  for (const p of PLATFORMS) {
    const f = autostartFile(p);
    const lines = EXPECTED[p].split(p === 'win32' ? '\r\n' : '\n');
    const at = p === 'win32' ? 1 : 2;
    mkdirSync(path.dirname(f), { recursive: true });
    const marker = lines[at];
    // Moved one line down, and kept only as a substring of another line: both are hand-written.
    const moved = [...lines.slice(0, at), 'x', ...lines.slice(at)].join('\n');
    const inline = [...lines.slice(0, at), `x ${marker}`, ...lines.slice(at + 1)].join('\n');
    for (const text of [moved, inline]) {
      writeFileSync(f, text);
      assert.deepEqual(autostartState(p), S(f, 'hand'));
      assert.equal(autostartRemove(p).ok, false);
      assert.equal(read(f), text, `${p}: a file with the marker off its line was touched`);
    }
    rmSync(f);
  }
});

test('a launcher in an agent worktree or the npx cache is flagged as transient', () => {
  for (const [root, want] of [
    ['C:\\Users\\me\\git\\Geneseed\\.claude\\worktrees\\web-autostart', true],
    ['/Users/me/git/Geneseed/.claude/worktrees/x', true],
    ['C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\3f2a\\node_modules\\geneseed', true],
    ['/Users/me/.npm/_npx/3f2a/node_modules/geneseed', true],
    ['C:\\Users\\me\\git\\Geneseed', false],
    ['/usr/local/lib/node_modules/geneseed', false],
    ['/Users/me/.claude/skills/geneseed', false],
  ]) assert.equal(transientRoot(root), want, root);
  assert.deepEqual(autostartState('win32'), S(autostartFile('win32'), 'absent'));
});

test('a write the OS refuses comes back with its own error text', () => {
  // A FILE where the folder should be: mkdir fails as a locked Startup folder would, with the
  // OS code in the message rather than a bare "failed".
  clear();
  const p = 'darwin';
  const dir = path.dirname(autostartFile(p));
  mkdirSync(path.dirname(dir), { recursive: true });
  writeFileSync(dir, 'not a folder');
  const r = autostartInstall(p);
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(`^could not write .*dev\\.geneseed\\.web\\.plist \\((EEXIST|ENOTDIR): `));
  rmSync(dir);
});

// ---- the route ----------------------------------------------------------------------------

const TOKEN = 'autostart-token';
const srv = http.createServer(makeHandler(webState('neutral'), new JobManager(), TOKEN, 'nowhere', {}));
await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
after(() => { srv.closeAllConnections(); srv.close(); });

async function post(body, token = TOKEN) {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/autostart`, { method: 'POST',
    headers: { 'X-Geneseed-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('POST /api/autostart without the token is refused and writes nothing', async () => {
  clear();
  const r = await post({ action: 'install' }, 'wrong');
  assert.equal(r.status, 403);
  for (const p of PLATFORMS) assert.equal(existsSync(autostartFile(p)), false);
});

test('POST /api/autostart refuses an action that is not install or remove', async () => {
  for (const body of [{}, { action: 'delete' }, { action: ['install'] }]) {
    assert.deepEqual(await post(body),
      { status: 409, body: { ok: false, error: 'body must be {action: install|remove}' } });
  }
});

test('POST /api/autostart writes only this platform\'s file, whatever path the body names', async () => {
  clear();
  const f = autostartFile();
  const elsewhere = path.join(path.dirname(path.dirname(autostartFile('win32'))), 'elsewhere.vbs');
  const r = await post({ action: 'install', path: elsewhere, file: elsewhere });
  assert.equal(existsSync(elsewhere), false, 'the body aimed the write');
  if (!f) {
    // Linux has no launcher: the route answers the refusal and writes nothing.
    assert.deepEqual(r, { status: 409,
      body: { ok: false, error: 'this platform has no login launcher Geneseed can write' } });
    return;
  }
  assert.deepEqual(r, { status: 200, body: { ok: true, autostart: S(f, 'ours') } });
  assert.equal(read(f), EXPECTED[process.platform]);
  assert.deepEqual(await post({ action: 'remove' }),
    { status: 200, body: { ok: true, autostart: S(f, 'absent') } });
});
