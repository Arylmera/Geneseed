// THE BROWSER OPENER, WHICH NO RECORDED CELL HAS EVER EXECUTED.
//
// `js/web/daemon.mjs`'s own docblock says it: every corpus cell passes `--no-browser`, so the
// 690 recorded cells run every other line of the web daemon and never this one. That is a
// structural hole, not an oversight — a cell that opened a browser on the recording machine
// would have been unrunnable in CI.
//
// What lived in the hole: the reference suppressed a missing opener with
// `contextlib.suppress(Exception)`, which works because Python's `subprocess` raises
// `FileNotFoundError` SYNCHRONOUSLY. The port wrapped `spawn` in `try/catch`, which reads as the
// same thing and is not: Node reports ENOENT on the child's `error` event, and an 'error' event
// with no listener is re-thrown as an uncaught exception. The suppression did not survive
// translation, and nothing noticed until a packaged install ran on a headless container with no
// `xdg-open` and printed `Error: spawn xdg-open ENOENT`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

test('a missing opener is survivable — spawn reports ENOENT as an EVENT, not a throw', async () => {
  // THE PROPERTY, DEMONSTRATED ON node:child_process ITSELF rather than asserted about it. This
  // is the fact the port got wrong, so it is worth proving here rather than trusting a memory of
  // how spawn behaves.
  let threwSynchronously = false;
  let sawErrorEvent = false;
  try {
    const child = spawn('geneseed-no-such-opener-xyz', ['http://127.0.0.1/'], {
      detached: true, stdio: 'ignore',
    });
    await new Promise((resolve) => {
      child.on('error', () => { sawErrorEvent = true; resolve(); });
      child.on('spawn', resolve);
    });
    child.unref();
  } catch {
    threwSynchronously = true;
  }
  assert.equal(threwSynchronously, false,
    'spawn threw synchronously for a missing binary — if Node has changed this, the `error` '
    + 'listener in openUrl may no longer be the thing keeping it quiet, and this test should be '
    + 'rewritten rather than deleted');
  assert.ok(sawErrorEvent,
    'a missing binary produced no `error` event, so this test is no longer exercising the '
    + 'condition it was written for');
});

test('openUrl listens for that event, so a box with no opener does not take the daemon down', () => {
  // A SOURCE ASSERTION, DELIBERATELY. openUrl detaches and ignores its stdio, and the failure is
  // asynchronous, so calling it here would either prove nothing or leak a process into the
  // suite. What can be checked is that the listener is present — which is the whole fix — and
  // that the `try/catch` alone is never again mistaken for sufficient.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'web', 'daemon.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function openUrl('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  assert.match(body, /\.on\('error'/,
    'openUrl no longer attaches an `error` listener to the spawned opener. A `try/catch` does '
    + 'NOT catch ENOENT from spawn — the event is re-thrown as an uncaught exception, and on a '
    + 'headless machine with no xdg-open that is every user who runs `geneseed web`');
  assert.ok(body.includes('.unref()'),
    'openUrl no longer unrefs the opener, so the CLI will not exit while a browser is open');
});

// REVEAL OPENS A FOLDER THROUGH EXPLORER, NEVER THROUGH cmd. A folder name is a filesystem
// string, and `cmd /c start "" "<dir>"` would expand any `%VAR%` in it. So on win32 a folder goes
// to explorer.exe by ABSOLUTE path (a bare name resolves against the cwd first), as one argv
// element, with no verbatim flag and no shell. A URL keeps the `start` form, and macOS / Linux
// open a folder with the same opener as a URL. Only the pure builder is called here: `openUrl`
// and `openFolder` would put a window on screen.
test('openerCommand: a win32 folder goes to explorer.exe as one argument', async () => {
  const daemon = await import('../../js/web/daemon.mjs');
  assert.equal(typeof daemon.openerCommand, 'function', 'daemon.mjs exports no openerCommand');
  const real = process.platform;
  const dir = 'C:\\a\\%USERPROFILE%\\b';
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const [file, args, extra] = daemon.openerCommand(dir, true);
    assert.ok(file.endsWith('explorer.exe'), file);
    assert.ok(path.win32.isAbsolute(file), `${file} is not absolute`);
    assert.deepEqual(args, [dir]);
    assert.equal(extra.windowsVerbatimArguments, undefined);
    assert.equal(extra.shell, undefined);
    const [ufile, uargs, uextra] = daemon.openerCommand('http://127.0.0.1:4747/', false);
    assert.ok(/cmd(\.exe)?$/i.test(ufile), ufile);
    assert.deepEqual(uargs, ['/d', '/s', '/c', 'start "" "http://127.0.0.1:4747/"']);
    assert.deepEqual(uextra, { windowsVerbatimArguments: true });
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    assert.deepEqual(daemon.openerCommand(dir, true), ['open', [dir], {}]);
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    assert.deepEqual(daemon.openerCommand(dir, true), ['xdg-open', [dir], {}]);
  } finally {
    Object.defineProperty(process, 'platform', { value: real, configurable: true });
  }
});

// The builder alone is not the fix: Reveal must CALL the folder path. A SOURCE ASSERTION, because
// driving the route would put a window on screen. Reverting the route to `openUrl(dir)` (back
// through `cmd start`) turns this red.
test('Reveal opens its folder through openFolder, not the URL opener', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'web', 'handler.mjs'), 'utf8');
  const route = src.slice(src.indexOf("if (path === '/api/reveal')"));
  const body = route.slice(0, route.indexOf("if (path === '/api/pick-folder')"));
  assert.ok(body.includes('openFolder(dir);'), 'the reveal route no longer calls openFolder(dir)');
  assert.ok(!/openUrl\(/.test(body), 'the reveal route calls openUrl, which runs cmd start');
});
