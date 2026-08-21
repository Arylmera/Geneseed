// `tests/test_harness.py`'s update-step block — and the place LIMITS ROW 8 is settled.
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
// SO IT LANDS HERE, AS A LIVE RUN. It retired first into the recorded cell
// `bootstrap__without-no-setup-it-hands-off-to-a-FRESH-setup-process`, and the last test in this
// file read that recording back to prove the retirement was not a promise. The corpus is gone —
// it was recorded from an implementation that no longer exists and can never be re-recorded — so
// the reading is now a gate on a file rather than on the harness, and the property would have no
// owner at all. The last test runs the verb instead, in a sandbox, with both streams on a PIPE:
// which is the exact condition under which the bug fires, and the reason the reference had to
// spell its own test as a subprocess too.
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

import { diagnoseFailedStep } from '../../js/maintain/update.mjs';
import { runCell } from '../helpers/cli_golden.mjs';
import { ROOT } from '../helpers/golden.mjs';
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
// LIMITS ROW 8's LIVE HALF: a failed step must leave a durable, legible trace.
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
 * `TheHandoffKeepsWhatWasAlreadyPrinted`, RUN rather than read back.
 *
 * THE SUBJECT IS `cmdBootstrap`'s HANDOFF, and the shape of the test is dictated by the bug: a
 * process that hands off can lose what it already wrote. In the reference `os.execv` replaced the
 * process image and took Python's stdio buffers with it, so `geneseed bootstrap > log.txt` lost
 * `[geneseed] ✓ update complete.` on every Unix run for as long as the verb existed. The port
 * cannot reproduce that mechanism — Node has no `execv` — but it has its own way to break the
 * same contract, and both need the streams to be PIPES to show it: on a terminal the parent's
 * writes are unbuffered and the bug is invisible. That is why this spawns rather than calling
 * `cmdBootstrap` in-process, and it is the reason the reference spelled its own test as a
 * subprocess too.
 *
 * THE FIXTURE IS `runCell`'s, and every part of it is load-bearing:
 *
 *   * `checkout: {}` gives the run its OWN ROOT — a copy of the tracked working tree, outside the
 *     snapshotted sandbox — and `runCell` repoints the argv at it. `ROOT` is where `upgrade`
 *     aims `git`, so without the copy the update step would run against the developer's real
 *     checkout: on a clean one it would FETCH, and on a dirty one the result would depend on
 *     whatever the developer had uncommitted.
 *   * The copy has no `.git` in it (`copyCheckout` copies files, not history), so `preflight`
 *     answers `not_git`. Every precondition in `PRE_MSG` is `info`, so the step returns 3, which
 *     `_bootstrap_plain`'s `rc not in (0, 3)` rule counts as a success — the step prints its
 *     banner and its `✓ update complete.` and nothing is pulled, rebuilt or written. Belt and
 *     braces on top: `runCell` sets `GIT_ALLOW_PROTOCOL=file`, so git in this child refuses an
 *     `https` transport outright, and `GIT_CEILING_DIRECTORIES`, so a `.git`-less copy cannot
 *     discover a repository above its temp directory.
 *   * `cellEnv` moves HOME/XDG/APPDATA into the sandbox, which is what keeps the install log and
 *     any install this touched off the developer's machine. It is ASSERTED below rather than
 *     assumed, because a relocation that silently stopped working would leave this test green
 *     while it wrote to a real home.
 *   * `spawnSync` is given `input`, so the child's stdin is a PIPE. `cmdSetup` gates on
 *     `process.stdin.isTTY`, the grandchild inherits that pipe through `reexec`'s
 *     `stdio: 'inherit'`, and its refusal on stderr is the proof the wizard never started — the
 *     wizard being the one thing under `setup` that would write a harness anywhere.
 *
 * ONE PLATFORM, HONESTLY. The retired cell asserted both halves of a two-platform recording; a
 * live run can only speak for the platform it ran on. What the recording bought there is not
 * recoverable and is not claimed here.
 */
test('bootstrap keeps what it already printed, then hands off to a FRESH setup', () => {
  const snap = runCell([process.execPath, path.join(ROOT, 'bin', 'geneseed-cli.mjs')],
    { checkout: {}, steps: [{ argv: ['bootstrap'], cwd: 'repo' }] });
  assert.ok(snap instanceof Map, `the bootstrap run never started: ${snap}`);
  const out = snap.get('<stdout>').toString('utf8');
  const err = snap.get('<stderr>').toString('utf8');

  // 1. PRINTED BEFORE THE HANDOFF, by the process that is about to hand off. The banner is the
  // first line the verb writes and `✓ update complete.` is the last one before `reexec`, which
  // is precisely the line the reference lost.
  assert.match(out, /\[geneseed\] step 1\/1: Update & rebuild \.\.\./,
    `nothing printed before the handoff survived it:\n${out}`);
  assert.match(out, /\[geneseed\] ✓ update complete\./,
    'the last line printed before the handoff did not survive it — that is the whole property '
    + `this test exists for:\n${out}`);
  assert.ok(out.indexOf('step 1/1') < out.indexOf('✓ update complete.'),
    `the parent's lines came back out of order:\n${out}`);
  // The fixture is only the fixture it claims to be while the step SUCCEEDS: a failed step
  // prints a diagnosis instead of `update complete`, and would take the assertion above with it
  // for a reason that has nothing to do with the handoff.
  assert.doesNotMatch(out, /✗ step/,
    `the update step failed, so this ran a different scenario than it names:\n${out}`);
  // AND WHICH PRECONDITION STOPPED IT, named rather than inferred. Every arm of `PRE_MSG` is
  // `info`, so `update complete` alone is equally satisfied by a copy that reached `ready` —
  // which is the one arm that FETCHES. Pinning the message is what keeps this run offline.
  assert.match(out, /This Geneseed install isn't a git checkout/,
    'the update step got past preflight, so this run was free to reach the network — the '
    + `checkout copy is no longer the .git-less one this test relies on:\n${out}`);

  // 2. PRINTED AFTER IT, by the successor. Without this the run is equally satisfied by a
  // `reexec` that quietly did nothing at all.
  assert.match(err, /\[setup\] needs an interactive terminal/,
    `the successor process left no trace, so nothing was handed off to:\n${err}`);

  // 3. AND THE SUCCESSOR'S STATUS, which `reexec` returns rather than swallowing. `cmdBootstrap`
  // answers 0 on this fixture when the handoff is skipped, so 1 can only have come through it.
  assert.equal(snap.get('<exit>').toString('utf8'), '1',
    "the successor's exit code was not propagated by the parent");

  // THE SANDBOX CLAIM, MEASURED. `Log` writes to `~/.geneseed-install.log`; finding it in the
  // snapshot — which walks the sandbox and nothing else — is the positive evidence that the home
  // this run wrote to was the sandbox's. Assert the relocation, never observe the leak.
  assert.ok(snap.has('home/.geneseed-install.log'),
    `the run's install log is not under the sandbox home — it went to a real one:\n${
      [...snap.keys()].join('\n')}`);
});
