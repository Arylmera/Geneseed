// THE BROWSER OPENER, WHICH NO RECORDED CELL HAS EVER EXECUTED.
//
// `js/web/server.mjs`'s own docblock says it: every corpus cell passes `--no-browser`, so the
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
  const src = fs.readFileSync(path.join(ROOT, 'js', 'web', 'server.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function openUrl('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  assert.match(body, /\.on\('error'/,
    'openUrl no longer attaches an `error` listener to the spawned opener. A `try/catch` does '
    + 'NOT catch ENOENT from spawn — the event is re-thrown as an uncaught exception, and on a '
    + 'headless machine with no xdg-open that is every user who runs `geneseed web`');
  assert.ok(body.includes('.unref()'),
    'openUrl no longer unrefs the opener, so the CLI will not exit while a browser is open');
});
