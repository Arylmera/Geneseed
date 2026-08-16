/**
 * `webFirstOk` over six environments and both answers to `isatty` —
 * `tests/test_pure_function_parity.py`'s `TheWebFirstDecisionAgreesOnAnInputNoCellCanGive`.
 *
 * WHY NO CELL CAN REACH IT. The decision reads six environment variables and then asks whether
 * fd 1 is a terminal. Every cell in every harness captures stdout through a pipe, so `isatty` is
 * false in all of them and the function short-circuits before any of the six knobs matters — the
 * entire body is unreachable from the matrix. The probe's `web_first_ok` case takes the isatty
 * answer as an ARGUMENT, which is what makes the other half of the decision observable at all.
 *
 * ONE PROCESS PER ROW, and it has to be. The knobs are read at call time rather than at import,
 * but `PATH` decides whether `xdg-open` resolves, and a test that poked `process.env` between two
 * in-process calls would be measuring a machine it had already modified. The rows also have to
 * mean the same thing on every host: `plain` names the two Linux display variables EXPLICITLY and
 * puts an `xdg-open` of its own on `PATH`, because inheriting either made the positive control
 * vacuous on exactly the machines the port is least tested on — a headless Linux runner being the
 * obvious one. A corpus that produces one answer measures nothing; one that produces both only on
 * the developer's laptop measures the laptop.
 *
 * WHAT DIED. `test_every_environment_produces_the_same_bytes` — the equality. Everything else in
 * the class already stated what the REFERENCE must answer and leaned on that equality to carry it
 * to the port; here they are asserted on the port directly, which is the same claim with one fewer
 * link in it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'pure_probe.mjs');
const LINUX = process.platform === 'linux';

const sandbox = makeSandbox('web-first-');
after(() => sandbox.cleanup());
const HOME = path.join(sandbox.path, 'home');
mkdirSync(HOME, { recursive: true });

/** An `xdg-open` this test owns, so `plain` does not depend on what the runner happens to have. */
const STUB = (() => {
  const d = path.join(sandbox.path, 'stubbin');
  mkdirSync(d, { recursive: true });
  const p = path.join(d, process.platform === 'win32' ? 'xdg-open.cmd' : 'xdg-open');
  writeFileSync(p, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(p, 0o755);
  return d;
})();

/** (name, env) — `null` UNSETS. Each row is one probe process. */
const ENVS = [
  // The baseline, with every knob the function reads explicitly absent — and the two it reads on
  // Linux explicitly PRESENT, so this row means the same thing on every host.
  ['plain', { GENESEED_NO_WEB: null, SSH_CONNECTION: null, SSH_TTY: null,
    DISPLAY: ':0', WAYLAND_DISPLAY: null, BROWSER: null,
    PATH: `${STUB}${path.delimiter}${process.env.PATH ?? ''}` }],
  // The display-server refusal: Linux only, false there and true on the platforms that never ask.
  // Both variables are one `or`, so a port that read only one answers this row differently.
  ['no-display', { GENESEED_NO_WEB: null, SSH_CONNECTION: null, SSH_TTY: null,
    DISPLAY: null, WAYLAND_DISPLAY: null, BROWSER: null,
    PATH: `${STUB}${path.delimiter}${process.env.PATH ?? ''}` }],
  // A non-empty value is truthy; an EMPTY one must NOT opt out — `GENESEED_NO_WEB=` in a shell
  // profile is a common way to write "not set".
  ['opted-out', { GENESEED_NO_WEB: '1', SSH_CONNECTION: null, SSH_TTY: null }],
  // Compared against `plain` below, so it carries `plain`'s display and browser controls too —
  // otherwise the two rows differ for a reason that has nothing to do with the empty opt-out,
  // which is precisely how it failed on the reference's first Linux run.
  ['opted-out-with-an-empty-value', { GENESEED_NO_WEB: '', SSH_CONNECTION: null, SSH_TTY: null,
    DISPLAY: ':0', WAYLAND_DISPLAY: null, BROWSER: null,
    PATH: `${STUB}${path.delimiter}${process.env.PATH ?? ''}` }],
  // The two SSH knobs are an `or`, so each needs its own row: a port that read only the first
  // agrees with the reference on every case where both are set.
  ['ssh-connection', { GENESEED_NO_WEB: null, SSH_CONNECTION: '10.0.0.1 51 10.0.0.2 22',
    SSH_TTY: null }],
  ['ssh-tty', { GENESEED_NO_WEB: null, SSH_CONNECTION: null, SSH_TTY: '/dev/pts/0' }],
];

// Both answers to the faked isatty, in this order — the results are read positionally.
const CASES = [{ fn: 'web_first_ok', args: [true] }, { fn: 'web_first_ok', args: [false] }];

let RUNS = null;
function runs() {
  if (RUNS) return RUNS;
  RUNS = {};
  for (const [name, overrides] of ENVS) {
    const dir = path.join(sandbox.path, `row-${name}`);
    mkdirSync(dir, { recursive: true });
    const job = path.join(dir, 'job.json');
    writeFileSync(job, JSON.stringify({ cases: CASES }), 'utf8');
    const env = cellEnv(HOME);
    // AFTER `cellEnv`, never before: it clears every GENESEED_* knob by PREFIX, so an override
    // set first would be wiped and the row would silently become a different row. Removed
    // case-insensitively for the reason `cellEnv` itself documents.
    for (const [k, v] of Object.entries(overrides)) {
      for (const e of Object.keys(env)) if (e.toLowerCase() === k.toLowerCase()) delete env[e];
      if (v !== null) env[k] = v;
    }
    const p = spawnSync(process.execPath, [PROBE, job], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(p.status, 0, `the ${name} row failed (${p.status}):\n${p.stderr}`);
    RUNS[name] = JSON.parse(p.stdout).results;
  }
  return RUNS;
}

test('every refusal is a refusal, on a TTY and off one', () => {
  // The three rows that must refuse whatever the terminal says.
  for (const name of ['opted-out', 'ssh-connection', 'ssh-tty']) {
    assert.deepEqual(runs()[name], [false, false],
      `${name} must refuse on a TTY and off one`);
  }
  // And off a TTY every row refuses, whatever else is set — the isatty test is second and nothing
  // after it can undo it.
  for (const [name, results] of Object.entries(runs())) {
    assert.equal(results[1], false, `${name} agreed to open a browser with no terminal`);
  }
});

test('an empty opt-out does not opt out', () => {
  // The one case where a wrong rule is invisible: `if (process.env.X)` is a truthiness test and a
  // port that wrote `!== undefined` passes every other row here.
  assert.deepEqual(runs()['opted-out-with-an-empty-value'], runs()['plain'],
    'an empty GENESEED_NO_WEB changed the answer, so it is being read as "set" rather than as the '
    + '"not set" a shell profile means by it');
});

test('the display refusal is Linux-only and the port knows it', () => {
  // One row with two correct answers: a Linux box with no display server cannot show a browser,
  // and Windows and macOS never ask. Naming the platform rather than skipping the row is
  // deliberate — a skipped row proves nothing, and the thing worth proving is where the line is
  // drawn.
  assert.equal(runs()['no-display'][0], !LINUX,
    LINUX ? 'a Linux host with no DISPLAY and no WAYLAND_DISPLAY agreed to open a browser'
      : 'a non-Linux host refused over a display server it never consults');
});

test('the corpus produced both answers', () => {
  // THE POSITIVE CONTROL, and this corpus needs one badly: every assertion above is satisfied by a
  // function that returns false unconditionally.
  const answers = new Set(Object.values(runs()).flat());
  assert.deepEqual([...answers].sort(), [false, true],
    'every row answered the same way, so this corpus cannot tell a working webFirstOk from one '
    + 'that always refuses');
  assert.equal(runs()['plain'][0], true,
    'the plain row refused on a TTY with a display and an xdg-open of its own — the True this '
    + 'control depends on has to come from a row that supplies its own preconditions, not from '
    + 'whatever the machine happens to have');
});
