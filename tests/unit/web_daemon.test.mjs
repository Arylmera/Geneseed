/**
 * The `web` verb's parts that neither a cell nor a corpus can reach.
 *
 * SUCCESSOR TO `tests/test_web_daemon.py`. Three harnesses cover most of this surface and each
 * stops somewhere specific: `cli_golden`'s `web` group compares the actions that TERMINATE
 * (`status`, `stop`, and the two `buildPlan` arms that refuse before a socket is bound) and
 * cannot run `start` or `restart`, because both leave a detached daemon behind and a cell's
 * teardown is an `rmSync` that a surviving child holding the log file open defeats;
 * `web_golden` runs a real server for all 114 of its cells; the primitives corpus compares
 * `buildPlan`, `daemonArgs` and `restartArgs` on inputs no cell can supply.
 *
 * WHAT IS LEFT IS THIS FILE. Eleven of the reference's fifteen cross; four were assertions about
 * the REFERENCE's own source, and each was the control for a twin that survives it — named at
 * each surviving test rather than listed, because a retirement whose gate is not named is prose.
 *
 * ⚠ PORT-LEDGER ROW 7 LIVES HERE, in `the committed dist is what makes the ask arm
 * unreachable`. `js/web/server.mjs` declares that no test reaches `npmBuild` because
 * `web/dist/index.html` is TRACKED, so `buildPlan` answers `serve` in every checkout a cell can
 * build. That is a claim about the REPOSITORY rather than about the code, and a docblock's claim
 * about another file goes stale silently — so it is re-derived from `git ls-files`. The day
 * `web/dist` stops being committed, this fails and says the `ask` arm has become reachable,
 * which is when it needs a gate rather than a declaration.
 *
 * ⚠ AND `/api/restart` IS THE ONE ROUTE WHERE PROBING THE DISPATCHER COSTS MORE THAN THE
 * ASSURANCE. It spawns a detached `web restart` that stops the daemon the record names and
 * starts a replacement outliving its caller: run from a test, the replacement binds 4747 on the
 * developer's machine and serves this checkout forever. So the dispatch is READ, and rule 7 —
 * a declaration is not a dispatcher — is left visible rather than quietly satisfied.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cliSpec } from '../../js/cli.mjs';
import { NOT_PORTED_POST, PORTED_POST_INLINE } from '../../js/web/server.mjs';
import { cellEnv, makeSandbox, strippedEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, 'bin', 'geneseed-cli.mjs');
const SERVER_JS = path.join(ROOT, 'js', 'web', 'server.mjs');
const serverSource = () => readFileSync(SERVER_JS, 'utf8');

/**
 * `harness.py`'s `web` subparser, read out of it with the reference's own `ast` reader on
 * 2026-08-16 and frozen here.
 *
 * The reference's argument for reading rather than transcribing was right — the Node spec is a
 * copy, and `--theme` added to one side alone would be accepted by one binary and rejected by
 * the other while the cells compared only the argvs they happen to name. There is no other side
 * to read now, so the frozen list is the second party: a fifth action or a sixth flag added to
 * `js/cli-table.json` has to be added here too, deliberately.
 */
const REF_WEB = {
  choices: ['start', 'stop', 'restart', 'status'],
  options: ['--port', '--theme'],
  flags: ['--daemon-internal', '--no-browser'],
  ints: ['--port'],
};

/** The prompt `serve()` prints when there is no built UI — measured from the reference. */
const NPM_PROMPT = '[web] UI not built — run npm install && npm run build now? [Y/n] ';

/** `if open_browser:` appeared on exactly three arms of the reference. */
const BROWSER_ARMS = 3;

test('the web spec carries every argument the reference declared', () => {
  // ABSORBS THE REFERENCE'S CONTROL. `test_the_reference_still_declares_the_web_subparser_this_
  // phase_measured` existed because a renamed `wb = sub.add_parser` would make the ast reader
  // return four empty lists and every equality below would hold against an equally empty copy.
  // With the lists frozen there is nothing left to go empty, and the same protection is the
  // literal above.
  //
  // THE SPEC, NOT A SOURCE SCRAPE, and P10c is why. This used to read the `web: { … }` row's own
  // hand-written positionals/options/flags/ints — a second transcription of the same subparser.
  // The row is `{ fn: cmdWeb }` now and the surface comes from `cliSpec()`, derived from
  // `js/cli-table.json`, so this asks the module the entry point itself calls. A `cliSpec` that
  // stopped deriving `ints` would still leave `'--port'` in the file for a scrape to find.
  const spec = cliSpec('web');
  const action = spec.positionals[0];
  assert.equal(action.name, 'action');
  assert.deepEqual(action.choices, REF_WEB.choices,
    'bin/geneseed-cli.mjs does not accept the same web actions the reference did, and a user '
    + 'types the same argv at either binary');
  for (const flag of REF_WEB.options) {
    assert.ok(flag in (spec.options ?? {}), `the web spec does not name ${flag}`);
  }
  for (const flag of REF_WEB.flags) {
    assert.ok(flag in (spec.flags ?? {}), `the web spec does not name ${flag}`);
  }
  for (const flag of REF_WEB.ints) {
    assert.ok((spec.ints ?? []).includes(flag),
      `${flag} was type=int on the reference and is untyped here — a non-integer would silently `
      + 'fall back to the default port');
  }
  // `nargs="?"` there. Named because a spec that made `action` REQUIRED would refuse the
  // foreground server, which is the shape a bare `geneseed web` has.
  assert.ok(action.optional,
    'the web spec\'s `action` is not optional; `geneseed web` with no action is the foreground '
    + 'server');
});

test('a non-integer port is refused rather than defaulted', () => {
  // THE `ints` COLUMN, DRIVEN, and its whole reason is that the alternative is SILENT: `pyInt`
  // answers null for 'abc' and a `?? 4747` would bind the default while the operator believes
  // they asked for another port. The reference's WORDING is not the claim — it prints a usage
  // block computed from the whole parser tree — but the refusal and its exit code are, and this
  // is the only assertion of them.
  const sb = makeSandbox('webdaemon-port-');
  try {
    const r = spawnSync(process.execPath, [CLI, 'web', 'status', '--port', 'abc'],
      { cwd: ROOT, input: '', encoding: 'utf8', windowsHide: true,
        env: cellEnv(path.join(sb.path, 'nowhere')) });
    assert.equal(r.status, 2, `a non-integer --port was accepted: ${r.stdout}`);
    assert.match(r.stderr, /invalid int value/);
    assert.ok(!r.stdout.includes('[web]'), 'the verb ran before its arguments were validated');
  } finally {
    sb.cleanup();
  }
});

test('the restart route is dispatched, not declared unported', () => {
  // THE PARTITION HALF `tests/unit/web_server.test.mjs` CHECKS AS A UNION AND SO CANNOT SEE: a
  // route moved out of `NOT_PORTED_POST` and into nothing at all keeps the union intact and
  // starts answering `{"error": "not found"}` at 404.
  assert.ok(![...NOT_PORTED_POST].includes('/api/restart'));
  assert.ok(PORTED_POST_INLINE.includes('/api/restart'),
    '/api/restart is neither declared unported nor declared as an inline dispatch — it would '
    + 'fall through to the shell\'s own 404');
  // EMPTY AND STILL DECLARED. Asserting the emptiness is what stops the declaration from being
  // quietly deleted, which is the one way an empty partition half stops being an assertion and
  // becomes an omission.
  assert.deepEqual([...NOT_PORTED_POST], [],
    'NOT_PORTED_POST is empty since P6i and must STAY DECLARED — an empty half of a partition is '
    + 'the partition asserting there is nothing left to declare');
});

test('the restart dispatch is read from source, because probing it costs a daemon', () => {
  // ⚠ RULE 7 LEFT VISIBLE. This is a gate on SOURCE, which is weaker than a probe, and the
  // reason is measured rather than preferred: `/api/restart` spawns a detached `web restart`
  // that outlives its caller, so a probe here would bind 4747 on the developer's machine and
  // serve this checkout forever. `tests/unit/web_server.test.mjs`'s dispatcher probe runs in
  // that same environment and deliberately does not ask.
  //
  // RETIREMENT: `test_the_reference_dispatches_restart_to_a_detached_web_restart` was the
  // control for exactly this assertion — the shape being matched. Its subject is
  // `rituals/_web_server.py` and it goes with the file; what it was holding the port against is
  // now stated directly.
  const text = serverSource();
  assert.ok(text.includes("if (path === '/api/restart') {"), 'no /api/restart branch');
  assert.ok(text.includes('requestRestart(state.theme);'),
    'the /api/restart branch no longer calls requestRestart');
  assert.ok(text.includes('{ restarting: true }'), 'the /api/restart branch answers differently');
  assert.match(text,
    /export function requestRestart\([\s\S]{0,400}?spawnDetached\(restartArgs\(theme\)/,
    'requestRestart no longer spawns a DETACHED restart — an in-process one dies with the '
    + 'daemon it was asked to replace');
});

test('the stop endpoint answers before it stops', () => {
  // THE ORDERING `web_golden`'s shutdown cell names but can only catch by luck. That cell is a
  // RACE gate: it fails only when the scheduler happens to lose the response, which on an idle
  // machine is never. Measured on a 16-core box under twelve CPU spinners and eight concurrent
  // cells, the reference lost 5 responses in 40 runs, in two shapes — nothing written, and the
  // headers written but not the body, which is what a response split across two writes looks
  // like when the process dies between them. A CI run that reproduces a 12% flake proves the bug
  // exists; a run that does not proves nothing. So the ORDER is asserted deterministically here.
  //
  // RETIREMENT: `test_the_reference_writes_the_response_before_it_starts_the_stopper` asserted
  // the same guarantee reached by a different means — the reference had to write BEFORE starting
  // the shutdown thread, because its request threads are daemon threads nothing joins. The port
  // reaches it the other way, and that is what is asserted.
  const text = serverSource();
  const parts = text.split("if (path === '/api/shutdown') {");
  assert.equal(parts.length, 2, 'no /api/shutdown branch');
  const branch = parts[1].split("if (path === '/api/restart')")[0];
  assert.match(branch,
    /res\.on\('finish', \(\) => \{\s*holder\.srv\.close\(\);\s*holder\.srv\.closeAllConnections\(\);\s*\}\);\s*return sendJson\(res, \{ stopping: true \}/,
    'the server must be closed from the response\'s `finish` handler and answered last — '
    + '`sendJson` only queues, so closing on the same tick destroys the socket under a response '
    + 'that has not reached it');
  // And nothing closes it outside that handler: one of each, the ones the match just placed.
  assert.equal(branch.split('holder.srv.close()').length - 1, 1, branch.slice(0, 400));
  assert.equal(branch.split('holder.srv.closeAllConnections()').length - 1, 1,
    branch.slice(0, 400));
});

test('the daemon launcher re-executes this runtime and names no interpreter', () => {
  // THE PASSTHROUGH QUESTION, asked of the one spawn `web` adds. `spawnDetached` starts a
  // process that RUNS THIS PROGRAM, which is the shape the whole port exists to remove
  // everywhere else — so the argument for it (the daemon must outlive its launcher, and no
  // in-process construct does) is backed by an assertion that what it re-executes is ITSELF.
  //
  // RETIREMENT: `test_the_reference_launches_its_own_interpreter_and_its_own_harness` was the
  // matching half, and after the cut "its own runtime" has only one meaning.
  const text = serverSource();
  assert.ok(text.includes(
    "const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web',"),
  'the detached launcher no longer names process.execPath and this repo\'s own CLI — a spawn '
    + 'taking its command from anywhere else would be the passthrough');
  // THE FUNCTION, NOT THE FILE, and that is deliberate: `python` appears in this module's prose,
  // and `js/web/jobs.mjs`'s argv is declared elsewhere. `spawnDetached` may name no interpreter
  // but the one it is already running.
  const from = text.indexOf('function spawnDetached(');
  assert.notEqual(from, -1, 'js/web/server.mjs has no spawnDetached');
  const body = text.slice(from, from + text.slice(from).indexOf('\n}\n'));
  for (const banned of ['python', 'harness.py', 'build.py', 'sys.executable']) {
    assert.ok(!body.includes(banned),
      `spawnDetached names ${banned}; the daemon must be a second implementation and not a `
      + 'launcher for the first');
  }
});

test('web status answers with no python on PATH', (t) => {
  // DYNAMIC, and the verb's cheapest honest refutation. A passthrough's `spawn('python',
  // 'harness.py', 'web', 'status')` dies with ENOENT here; a second implementation never
  // notices. `status` is the arm chosen because it TERMINATES and starts nothing — `start` would
  // leave a daemon on this machine.
  const sb = makeSandbox('webdaemon-nopy-');
  try {
    const home = path.join(sb.path, 'home');
    mkdirSync(home, { recursive: true });
    const r = spawnSync(process.execPath, [CLI, 'web', 'status'],
      { cwd: sb.path, input: '', encoding: 'utf8', windowsHide: true, env: strippedEnv(t, home) });
    assert.equal(r.status, 1,
      `web status did not report 'not running' with python off PATH:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /\[web\] not running\./);
  } finally {
    sb.cleanup();
  }
});

test('the committed dist is what makes the ask arm unreachable', () => {
  // ⚠ PORT-LEDGER ROW 7, re-derived rather than trusted. See the header.
  const r = spawnSync('git', ['ls-files', '--', 'web/dist/index.html'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'web/dist/index.html',
    'web/dist/index.html is no longer tracked — `npmBuild` and the interactive `ask` prompt are '
    + 'now reachable from a fresh checkout and are declared as if they were not');
  // The other direction, and it is what makes the line above a claim about REACHABILITY rather
  // than about a filename: the file must also be on disk, or `buildPlan` answers `ask` in this
  // very checkout while `git ls-files` still lists it.
  assert.ok(existsSync(path.join(ROOT, 'web', 'dist', 'index.html')),
    'web/dist/index.html is tracked but absent from the working tree, so the `ask` arm is '
    + 'reachable here and now');
});

test('the npm-build prompt is the one the reference printed', () => {
  // THE WORDING OF AN UNREACHABLE PROMPT, which nothing else can check. `promptLine`'s BEHAVIOUR
  // is gated by a stdin-seeded corpus — including the EOF arm, the one that would otherwise
  // answer YES to this question on every non-interactive run. What no corpus can see is the
  // string `serve()` passes it, because the `ask` arm needs a TTY and a checkout with no
  // `web/dist`. Frozen from the reference rather than compared against it.
  const js = serverSource();
  assert.ok(js.includes(`promptLine('${NPM_PROMPT}')`),
    'the no-UI prompt is not the wording the reference printed');
  // The dangerous half: `''` is in the accepted set, so reading EOF as an empty line answers YES.
  assert.ok(js.includes("const answer = line === null ? 'n' : line;"),
    'EOF is no longer read as `n` — a non-interactive run would answer YES to a prompt that '
    + 'then runs npm install');
});

test('the browser open is wired to the flag on all three arms', () => {
  // THE ONE BRANCH NO HARNESS MAY DRIVE. `--no-browser` is passed by every cell that reaches
  // `serve` — a gate that popped a browser window on the developer's screen would be worse than
  // the bug it caught. So the flag's three consumers (`serve`, and `startDaemon`'s
  // already-running and came-up arms) are COUNTED: a port that dropped one would open no window
  // on a `web start`, and nothing else in this repo would notice.
  const arms = (serverSource().match(/if \(openBrowser\) openUrl\(/g) ?? []).length;
  assert.equal(arms, BROWSER_ARMS,
    `openBrowser is consulted on ${arms} arms; the reference consulted its flag on `
    + `${BROWSER_ARMS}`);
});

test('the npm step pair is install then build', () => {
  // `npm run build` without `npm install` on a fresh checkout fails on a missing vite; the
  // reverse order is the same failure.
  assert.ok(serverSource().includes("for (const step of [['install'], ['run', 'build']]) {"),
    'the npm steps are no longer install-then-build');
});
