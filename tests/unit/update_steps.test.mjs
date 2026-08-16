// `tests/test_harness.py`'s update-step block — and the place PORT-LEDGER ROW 8 is settled.
//
// Ten Python tests across four classes reach this ground: WindowsProgressUi (2), Reexec (2),
// UpdateStepDiagnosis (3), UpdateStepSelfHeal (3). ONE property survives with a live subject,
// and it lands here absolutely. The other nine describe machinery that is Python's, and the
// plan's own instruction for row 8 is to recast them as HISTORY rather than to pretend a
// successor exists.
//
// WHAT BECOMES HISTORY, AND WHY EACH — because "it dies with the reference" is true of every
// cross-implementation test in this suite and is therefore an argument for retiring nothing.
//
//   * `_harness_supports(path, sub)` PROBES A PYTHON FILE — it runs `rituals/harness.py --help`
//     and greps argparse's output for a subcommand. Its subject is a file P4 deletes.
//   * `_stale_factory_hint` and the fallback in `_update_step_cmd` exist for ONE failure the
//     port cannot have: a `harness.py` on disk too old to know `upgrade`, dead-ending on
//     argparse's `invalid choice`. `js/update.mjs`'s own docblock argues it out — the step is
//     an IMPORT, not a spawn, so there is no second program to be stale, no argparse to refuse,
//     and no `invalid choice` to recognise. A twin that spawned a `--help` probe to answer a
//     question it already knows would be ceremony. The gap IS the design.
//   * `_pipe_select_ok` and `_run_logged` are the CURSES progress runner (WinSock `select()`
//     cannot wait on pipe fds; the legacy console code page cannot decode the child's UTF-8).
//     No curses, no `_winterm`, no pipe to select on. `tests/unit/no_panel.test.mjs` keeps it
//     gone.
//   * `_reexec`'s two branches collapse into one: Node has no `execv`, so the port is ALWAYS
//     the reference's Windows branch — run the child, exit with its status. The Unix test
//     asserts a call to `os.execv` that cannot be made.
//
// A THIRD REEXEC TEST LANDS HERE TOO — `tests/test_update.py`'s
// `TheHandoffKeepsWhatWasAlreadyPrinted`, which is a different claim from the two above and does
// NOT become history. Off a terminal, `os.execv` replaces the process image and Python's stdio
// buffers go with it, so `geneseed bootstrap > log.txt` lost `[geneseed] ✓ update complete.` on
// every Unix run for as long as the verb existed. The port cannot reproduce the mechanism — Node
// has no `execv`, so `reexec` is always the reference's Windows branch — but the CONTRACT is the
// same on both and Node has its own way to break it: `process.exit()` truncates pending async
// writes to a pipe exactly as `execv` discarded buffered ones.
//
// IT RETIRES INTO A GATE THAT IS ALREADY STRONGER, and the last test in this file is what stops
// that retirement from being a promise. The recorded cell
// `bootstrap__without-no-setup-it-hands-off-to-a-FRESH-setup-process` runs the real handoff with
// stdout on a PIPE — which is the exact condition under which the bug fires, and the reason the
// reference had to spell its own test as a subprocess — and compares the whole stream as bytes,
// on both platform halves. Where the reference makes two `assertIn`s, the cell pins 299 bytes of
// parent output, the successor's own stderr, and the exit code the successor handed back.
//
// ONE THING IS OWED ELSEWHERE, and it is written down rather than assumed covered: the
// reference's step command names an interpreter and a `.py`, and the port's names
// `process.execPath` plus this repo's own CLI, so no spelling of `python` can reach it. That is
// a claim about the SOURCE and it belongs to P4's repo-wide no-python scan, which must name
// `js/update.mjs` when it is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnoseFailedStep } from '../../js/update.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/**
 * Run `fn` with `GENESEED_LOG` pointed at a temp file, and hand back what was written.
 *
 * ALWAYS SET, NEVER INHERITED. `logfile()` falls back to a real path under the user's home when
 * the variable is absent, so a test that forgot it would append to the developer's actual
 * install log — and would still pass. Assert on the environment, never observe the leak.
 */
function withLog(fn) {
  const sb = makeSandbox('gs-log-');
  const logp = path.join(sb.path, 'install.log');
  const saved = process.env.GENESEED_LOG;
  process.env.GENESEED_LOG = logp;
  try {
    const lines = fn(logp);
    const body = fs.existsSync(logp) ? fs.readFileSync(logp, 'utf8') : null;
    return { lines, body, logp };
  } finally {
    if (saved === undefined) delete process.env.GENESEED_LOG;
    else process.env.GENESEED_LOG = saved;
    sb.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------
// PORT-LEDGER ROW 8's LIVE HALF: a failed step must leave a durable, legible trace.
//
// The persistence is the point rather than a nicety, and the reference's field report is the
// argument: "refresh ok, then update factory step 2/2 failed". The curses log pane is ephemeral
// and the plain path's child output scrolls past, so without the file the only trace of WHY a
// step failed is gone the moment the screen tears down — while the error two frames up tells
// the user to go and look for details.

test('a failed step persists a legible trace and points the user at it', () => {
  const cmd = [process.execPath, 'bin/geneseed-cli.mjs', 'upgrade'];
  const { lines, body, logp } = withLog(
    () => diagnoseFailedStep(2, 2, 'Update factory & rebuild bundle', cmd, 2,
      'error: the update step fell over'));

  assert.notEqual(body, null, 'nothing was written to the install log at all');
  assert.ok(body.includes('step 2/2'), body);
  assert.ok(body.includes("FAILED (exit 2)"), body);
  assert.ok(body.includes('Update factory & rebuild bundle'), body);
  // THE COMMAND IS THE PART A USER ACTS ON. The log promises something they can re-run, so it
  // has to be there verbatim rather than summarised.
  assert.ok(body.includes(cmd.join(' ')), body);
  assert.ok(body.includes('error: the update step fell over'), body);

  // And the LIVE lines have to route the user to the file, or the persistence helps nobody.
  assert.ok(lines.some((ln) => ln.includes('step 2/2') && ln.includes('FAILED (exit 2)')),
    JSON.stringify(lines));
  assert.ok(lines.some((ln) => ln.includes(logp)),
    `the returned lines never name the log they wrote:\n${JSON.stringify(lines)}`);
});

test('the trace APPENDS rather than replacing an earlier failure', () => {
  // Two steps can fail in one run, and an update that overwrote its own log would leave the
  // user the last failure only — which is reliably not the interesting one.
  const { body } = withLog(() => {
    diagnoseFailedStep(1, 2, 'first step', ['a'], 9, 'first output');
    return diagnoseFailedStep(2, 2, 'second step', ['b'], 8, 'second output');
  });
  assert.ok(body.includes('first step') && body.includes('first output'),
    `the first failure was overwritten:\n${body}`);
  assert.ok(body.includes('second step') && body.includes('second output'), body);
  assert.ok(body.indexOf('first step') < body.indexOf('second step'),
    'the log is not in the order the steps ran');
});

test('an empty output still logs the step, and adds no blank body', () => {
  // THE PATH THE PORT ACTUALLY TAKES. The reference passes a captured re-probe here; the twin
  // has no probe and always passes '', so this is the only shape that runs in production — and
  // the header must still be written, because "which step failed" is most of the diagnosis.
  const { lines, body } = withLog(
    () => diagnoseFailedStep(1, 1, 'Update & rebuild', ['x', 'y'], 4, ''));
  assert.ok(body.includes('step 1/1'), body);
  assert.ok(body.includes('FAILED (exit 4)'), body);
  assert.ok(body.includes('x y'), body);
  assert.ok(!/\n\n\n/.test(body), `an empty output left a blank stanza:\n${body}`);
  assert.ok(lines.length >= 1);
});

test('a step that cannot write its log still returns its lines', () => {
  // The failure mode of a diagnosis is not allowed to be a second failure. `logfile()` can
  // answer a path that is unwritable — a read-only home, a directory where a file is expected —
  // and the reference swallows the OSError. If this threw, an update step that failed for one
  // reason would abort the whole run for another.
  const sb = makeSandbox('gs-badlog-');
  const saved = process.env.GENESEED_LOG;
  try {
    // A path whose PARENT is a file, so opening it cannot succeed on any platform.
    const wall = path.join(sb.path, 'wall');
    fs.writeFileSync(wall, 'not a directory');
    process.env.GENESEED_LOG = path.join(wall, 'install.log');
    const lines = diagnoseFailedStep(1, 1, 'Update & rebuild', ['x'], 5, '');
    assert.ok(lines.some((ln) => ln.includes('FAILED (exit 5)')),
      `the diagnosis lost its own message when the log was unwritable: ${JSON.stringify(lines)}`);
  } finally {
    if (saved === undefined) delete process.env.GENESEED_LOG;
    else process.env.GENESEED_LOG = saved;
    sb.cleanup();
  }
});

/**
 * THE GATE ON THE RETIREMENT, not a second copy of it.
 *
 * `TheHandoffKeepsWhatWasAlreadyPrinted` retires into a recorded cell (see the header), and a
 * retirement whose named gate can be deleted or re-blessed into vacuity is prose. This asserts
 * the cell still SAYS what the retirement claims it says: the parent's pre-handoff lines are in
 * `<stdout>`, the successor really ran and left its own words in `<stderr>`, and the successor's
 * status came back as the process exit code. On BOTH halves, because the failure the reference
 * documents is a POSIX one and the `lf` half is the only recording made on POSIX.
 *
 * It reads the snapshot rather than re-running the verb: re-running is `tests/cli_golden.mjs`'s
 * job and doing it again here would be a slower copy of a gate that already exists. What is
 * missing without this is the link between the two — nothing else in the tree records that this
 * particular cell is load-bearing for a property that has no other owner.
 */
test('the recorded handoff cell still carries both sides of the handoff', () => {
  const CELL = 'bootstrap__without-no-setup-it-hands-off-to-a-FRESH-setup-process.json';
  const here = path.dirname(fileURLToPath(import.meta.url));       // tests/unit
  const root = path.join(path.dirname(here), '__snapshots__', 'cli');
  for (const half of ['crlf', 'lf']) {
    const file = path.join(root, half, CELL);
    assert.ok(fs.existsSync(file),
      `${half}/${CELL} is gone — TheHandoffKeepsWhatWasAlreadyPrinted retired into it`);
    const cell = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = cell.verbatim?.['<stdout>'] ?? '';
    const err = cell.verbatim?.['<stderr>'] ?? '';

    // Printed BEFORE the handoff, by the process that is about to be replaced. The first is the
    // step banner and the last is the line the reference names as the one Unix actually lost.
    assert.match(out, /step 1\/1: Update & rebuild/,
      `${half}: the cell no longer records anything printed before the handoff`);
    assert.match(out, /update complete/,
      `${half}: the cell lost the last line printed before the handoff — which is exactly the `
      + 'line os.execv discarded, and the property this cell is retained for');
    // Printed AFTER it, by the successor — without which the cell is equally satisfied by a
    // `reexec` that quietly did nothing at all.
    assert.match(err, /\[setup\] needs an interactive terminal/,
      `${half}: the cell no longer shows the successor process running`);
    // And the successor's status, which `reexec` returns rather than swallowing.
    assert.equal(cell.verbatim?.['<exit>'], '1',
      `${half}: the successor's exit code is no longer propagated through the handoff`);
  }
});
