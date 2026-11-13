// The done gate (#289, `js/hosts/hooks-done.mjs`): Verify Before Asserting at Stop.
//
// Asserted in BOTH directions, because a gate that never blocks passes every "allows" row and
// a gate that always blocks passes every "blocks" row. The decision is driven over transcript
// TEXT here (each row writes its expected answer out); the wiring is driven through the real
// hook binary as a child process, where the one property that matters most is visible: an
// allow prints NOTHING on stdout, and a block prints exactly one JSON verdict with exit 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { doneDecide, groupPasses, nextBlock, runsUnpiped, weakenedIn } from '../../js/hosts/hooks-done.mjs';
import { doneLine, inferDoneChecks } from '../../js/hosts/done-checks.mjs';
import { isTestPath, tailReader, weakenedBy } from '../../js/hosts/hooks-prims.mjs';
import { readTail } from '../../js/lib/fs.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

const R = path.resolve('/proj');
const CHECKS = ['npm run lint', 'node --test'];

// One transcript line per call, in Claude Code's JSONL shape.
const prompt = (text = 'go') => ({ type: 'user', message: { role: 'user', content: text } });
let n = 0;
function call(name, input, isError = false) {
  n += 1;
  const id = `t${n}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } },
  ];
}
const edit = (p = path.join(R, 'a.js'), err = false) => call('Edit', { file_path: p }, err);
const bash = (command, err = false) => call('Bash', { command }, err);
const jsonl = (...rows) => rows.flat().map((o) => JSON.stringify(o)).join('\n');

test('doneDecide: which checks are still owed when the turn ends', () => {
  // Each row: the turn, then the checks it still owes.
  const rows = [
    ['no edit in the turn owes nothing', [prompt(), bash('ls')], []],
    ['an edit with no proof owes every check', [prompt(), edit()], CHECKS],
    ['both checks passing after the edit owe nothing',
      [prompt(), edit(), bash('npm run lint'), bash('node --test "tests/**"')], []],
    ['a check run BEFORE the edit does not count',
      [prompt(), bash('npm run lint && node --test'), edit()], CHECKS],
    ['a failed check (is_error) does not count',
      [prompt(), edit(), bash('npm run lint', true), bash('node --test')], ['npm run lint']],
    ['a piped check does not count: a pipe exits with its last stage',
      [prompt(), edit(), bash('npm run lint | tail -5'), bash('node --test')], ['npm run lint']],
    // `||` is not a pipe, but it masks the exit code: `|| true` exits 0 on a red lint.
    ['a check masked by `|| true` does not count',
      [prompt(), edit(), bash('npm run lint || true; node --test')], ['npm run lint']],
    ['a denied edit changed nothing', [prompt(), edit(undefined, true)], []],
    ['an edit outside the project root is not this project\'s', [prompt(), edit(path.resolve('/elsewhere/x.js'))], []],
    ['a relative edit path resolves against the project', [prompt(), call('Write', { file_path: 'src/b.js' })], CHECKS],
    ['the previous turn\'s edit is not this turn\'s',
      [prompt('one'), edit(), prompt('two'), bash('ls')], []],
    ['a tool_result line does not open a turn',
      [prompt(), edit(), bash('ls'), bash('npm run lint')], ['node --test']],
  ];
  for (const [what, turn, owed] of rows) {
    assert.deepEqual(doneDecide(jsonl(...turn), CHECKS, R), owed, what);
  }
});

test('doneDecide: a call with no result yet is not a pass', () => {
  const [use] = bash('npm run lint');
  assert.deepEqual(doneDecide(jsonl(prompt(), edit(), use, bash('node --test')), CHECKS, R),
    ['npm run lint']);
});

// A `run_in_background` Bash call as Claude Code records it: the result comes at once, not an
// error, with `toolUseResult.backgroundTaskId` set. The completion is a later notification,
// written as a `queued_command` attachment AND as a user line holding the same text.
function bgBash(command) {
  const [use, result] = bash(command);
  use.message.content[0].input.run_in_background = true;
  return [use, { ...result, toolUseResult: { backgroundTaskId: 'b1' } }];
}
const lastId = () => `t${n}`;
const noteText = (id, status, summary) => `<task-notification>\n<task-id>b1</task-id>\n`
  + `<tool-use-id>${id}</tool-use-id>\n<output-file>x.output</output-file>\n<status>${status}</status>\n`
  + `<summary>${summary}</summary>\n</task-notification>`;
const noteAttachment = (id, status, summary) => ({ type: 'attachment',
  attachment: { type: 'queued_command', prompt: noteText(id, status, summary), commandMode: 'task-notification' } });
const noteUserLine = (id, status, summary) => ({ type: 'user',
  message: { role: 'user', content: noteText(id, status, summary) } });

test('doneDecide: a background launch passes only on a completed, exit-0 notification', () => {
  const C = ['npm run lint'];
  const ok = 'Background command "npm run lint" completed (exit code 0)';
  const launch = () => { const rows = bgBash('npm run lint'); return { rows, id: lastId() }; };
  // Each row: what it shows, the turn, the checks still owed.
  const rows = [
    ['a launch alone owes its check: the result says it started', (l) => [prompt(), edit(), l.rows], C],
    ['a launch then its completed exit-0 notification passes',
      (l) => [prompt(), edit(), l.rows, noteAttachment(l.id, 'completed', ok)], []],
    ['a failed notification (exit 1) owes it',
      (l) => [prompt(), edit(), l.rows, noteAttachment(l.id, 'failed',
        'Background command "npm run lint" failed with exit code 1')], C],
    ['a notification for another tool-use id owes it',
      (l) => [prompt(), edit(), l.rows, noteAttachment('toolu_other', 'completed', ok)], C],
    ['killed is not completed', (l) => [prompt(), edit(), l.rows, noteAttachment(l.id, 'killed',
      'Background command "npm run lint" was stopped')], C],
    // The summary quotes the command: "exit code 0" inside it is the command's text.
    ['"exit code 0" inside the quoted command is no exit code',
      (l) => [prompt(), edit(), l.rows, noteAttachment(l.id, 'completed',
        'Background command "npm run lint; echo (exit code 0)" completed (exit code 1)')], C],
    // The notification's user line is no prompt: as one it would open a new turn with no edit.
    ['the notification as a user line proves it, and opens no turn',
      (l) => [prompt(), edit(), l.rows, noteUserLine(l.id, 'completed', ok)], []],
    ['a failed notification user line opens no turn either',
      (l) => [prompt(), edit(), l.rows, noteUserLine(l.id, 'failed', 'failed with exit code 1')], C],
    // Placed by the CALL: a launch before the last edit proves nothing, even completing after it.
    ['a launch before the last edit does not count, whenever it completes',
      (l) => [prompt(), l.rows, edit(), noteAttachment(l.id, 'completed', ok)], C],
  ];
  for (const [what, build, owed] of rows) {
    assert.deepEqual(doneDecide(jsonl(...build(launch())), C, R), owed, what);
  }
  // `run_in_background` on the input alone marks it, with no backgroundTaskId on the result.
  const [use, result] = bash('npm run lint');
  use.message.content[0].input.run_in_background = true;
  assert.deepEqual(doneDecide(jsonl(prompt(), edit(), [use, result]), C, R), C, 'input flag alone');
  // A call MOVED to the background after its timeout, in a sub-agent's transcript: no input flag
  // and no `toolUseResult` there, only the host's text (seen 2026-11). Each row: the result text,
  // whether a completed exit-0 notification follows, the checks owed.
  const moved = [
    ['Command was moved to the background (ID: b0bg5s9zn) after running for 180s. Output is being written to: x', false, C],
    ['Command did not complete within its 120s timeout and was moved to the background (ID: b664tiy7t). Output: x', false, C],
    ['Command running in background with ID: bd5606fh4. Output is being written to: x', false, C],
    ['Command was moved to the background (ID: b0bg5s9zn) after running for 180s.', true, []],
    // An ordinary result that only mentions the words later is a finished run.
    ['ok: the Command was moved to the background docs page', false, []],
  ];
  for (const [text, notified, owed] of moved) {
    const [u, r] = bash('npm run lint');
    const id = lastId();
    r.message.content[0].content = [{ type: 'text', text }];
    const rows = side([prompt('brief'), edit(), [u, r], ...(notified ? [noteAttachment(id, 'completed', ok)] : [])]);
    assert.deepEqual(doneDecide(jsonl(rows), C, R, R, true, true), owed, text);
  }
});

test('runsUnpiped: the segment rule, written out', () => {
  const rows = [
    ['npm test', 'npm test', true],
    ['npm test 2>&1', 'npm test', true],
    ['npm test | tail', 'npm test', false],
    ['npm test |tail', 'npm test', false],
    ['npm test && echo ok | cat', 'npm test', true],      // the pipe is in the NEXT segment
    ['npm test | tail; npm test', 'npm test', true],        // one unpiped run is enough
    // A masked exit code is not a run: each of these exits 0 on a red suite.
    ['npm test || true', 'npm test', false],
    ['npm test || exit 1', 'npm test', false],              // any `||`, even an honest one
    ['npm test; true', 'npm test', false],
    ['npm test ;true', 'npm test', false],
    ['npm test; :', 'npm test', false],
    ['npm test; exit 0', 'npm test', false],
    ['npm test; exit', 'npm test', false],
    ['npm test\ntrue', 'npm test', false],
    ['npm test && echo ok; true', 'npm test', false],       // the mask ends the whole line
    // `echo` and `printf` always succeed too, and reporting the code this way is common.
    ['npm test; echo "exit: $?"', 'npm test', false],
    ['npm test 2>&1; echo done', 'npm test', false],
    ['npm test\nprintf ok', 'npm test', false],
    // Backgrounded, the check's status is never the line's. `2>&1` is no background.
    ['npm test &', 'npm test', false],
    // After `||` the check may never run.
    ['true || npm test', 'npm test', false],
    // ...but `&&` masks nothing, and a real next command is not a mask.
    ['npm test && echo ok', 'npm test', true],
    ['npm test; npm run lint', 'npm test', true],
    ['npm test; npm run lint', 'npm run lint', true],
    ['npm test; exit $LASTEXITCODE', 'npm test', true],     // passes the code on
    ['npm test; truecolor', 'npm test', true],              // a longer word is not `true`
    ['cd web &&  npm   test', 'npm test', true],              // whitespace collapsed
    ['npm run build', 'npm test', false],
    // A whole command only: at a segment start, ended by whitespace, a separator or the end.
    ['npm run lint:fix', 'npm run lint', false],             // a longer command is not the check
    ['npm testing', 'npm test', false],
    ['git commit -m "ran npm test"', 'npm test', false],    // a mention in a message
    ['git commit -m "x; npm test"', 'npm test', false],     // a separator inside quotes is text
    ['echo npm test', 'npm test', false],                   // an argument, not a command
    ['echo "a\\"; npm test"', 'npm test', false],           // an escaped quote keeps the string open
    ['npm test -- --watch=false', 'npm test', true],        // arguments are allowed
    ['cd x && npm test', 'npm test', true],
    ['cd x; npm test', 'npm test', true],
    ['cd x\nnpm test', 'npm test', true],
    ['npm test&& echo ok', 'npm test', true],
  ];
  for (const [cmd, line, want] of rows) assert.equal(runsUnpiped(cmd, line), want, cmd);
});

// ---- through the real hook binary ------------------------------------------------------

/** A git project with a done list, an install root, and a Stop payload runner. */
function project({
  checks = 'npm run lint\n', transcriptRows = [], host = null, active = false, extra = [],
  files = {}, llm = null, llmExit = 0,
} = {}) {
  const sb = makeSandbox();
  const proj = path.join(sb.path, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(proj, rel), text);
  if (checks !== null) {
    fs.mkdirSync(path.join(proj, '.geneseed'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.geneseed', 'done-checks.txt'), checks);
  }
  const install = path.join(sb.path, 'install');
  fs.mkdirSync(path.join(install, 'notebook'), { recursive: true });
  const transcript = path.join(sb.path, 't.jsonl');
  fs.writeFileSync(transcript, jsonl(...transcriptRows.map((r) => (typeof r === 'function' ? r(proj) : r))));
  const payload = host === 'bob' ? { event: 'Stop', session_id: 's' }
    : { hook_event_name: 'Stop', session_id: 's', cwd: proj, transcript_path: transcript,
      stop_hook_active: active };
  const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) };
  delete env.GENESEED_LLM;
  delete env.GENESEED_LEARN_CHILD;
  if (llm) {
    // A model CLI that answers NOTHING — the learn path that used to print its answer on stdout.
    const stub = path.join(sb.path, 'llm.mjs');
    fs.writeFileSync(stub, `process.stdout.write(${JSON.stringify(llm)}); process.exitCode = ${llmExit};\n`);
    // `node` from PATH: `$GENESEED_LLM` is split on whitespace, and execPath may hold a space.
    env.GENESEED_LLM = `node ${stub}`;
  }
  try {
    const argv = ['learn', '--memory', path.join(install, 'memory'), ...(host ? ['--host', host] : []),
      ...extra];
    const p = spawnHook(argv, JSON.stringify(payload), { cwd: proj, env });
    let ledger = '';
    try { ledger = fs.readFileSync(path.join(install, 'notebook', 'gates.jsonl'), 'utf8'); } catch { /* none */ }
    return { rc: p.status, out: p.stdout, err: p.stderr, ledger };
  } finally {
    sb.cleanup();
  }
}
const editIn = (proj) => edit(path.join(proj, 'a.js'));

test('learn on Stop: a turn that edited without its proof is blocked, once', () => {
  const r = project({ transcriptRows: [prompt(), editIn] });
  assert.equal(r.rc, 0, r.err);
  const verdict = JSON.parse(r.out);
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /Verify Before Asserting/);
  assert.match(verdict.reason, /npm run lint/);
  assert.match(r.ledger, /"verb":"done-gate","rule":"law-3"/);

  // The same turn after one block: the cap lets it end, and leaves a trace.
  const again = project({ transcriptRows: [prompt(), editIn], active: true });
  assert.equal(again.rc, 0);
  assert.equal(again.out, '', 'the cap must allow with nothing on stdout');
  assert.match(again.err, /cap reached/);
  assert.match(again.ledger, /"verb":"done-gate-cap","rule":"law-3"/);
});

test('learn on Stop: every allow path prints nothing on stdout', () => {
  const rows = [
    ['the proof passed after the edit', { transcriptRows: [prompt(), editIn, bash('npm run lint')] }],
    ['no done list: the gate is off', { checks: null, transcriptRows: [prompt(), editIn] }],
    ['an empty done list: the gate is off', { checks: '# nothing yet\n', transcriptRows: [prompt(), editIn] }],
    ['no edit this turn', { transcriptRows: [prompt(), bash('ls')] }],
  ];
  for (const [what, opts] of rows) {
    const r = project(opts);
    assert.equal(r.rc, 0, `${what}: ${r.err}`);
    assert.equal(r.out, '', `${what}: stdout must stay empty, got ${JSON.stringify(r.out)}`);
    assert.equal(r.ledger, '', `${what}: an allow records nothing`);
  }
});

// `--no-done-gate` (user decision 2026-10-18): the install switched Law III's gate off. The same
// unproven turn that blocks above ends silently, with nothing in the ledger — and Bob's
// "not judged" line goes quiet, while learn's own I2 line still runs (learning is not skipped).
test('learn --no-done-gate: the unproven turn ends, and learning still runs', () => {
  const r = project({ transcriptRows: [prompt(), editIn], extra: ['--no-done-gate'] });
  assert.equal(r.rc, 0, r.err);
  assert.equal(r.out, '', 'a disarmed done gate printed a verdict');
  assert.equal(r.ledger, '', 'a disarmed done gate recorded an ask');
  const bob = project({ host: 'bob', extra: ['--no-done-gate'] });
  assert.equal(bob.rc, 0);
  assert.equal(bob.err.includes('[done-gate]'), false, bob.err);
  assert.match(bob.err, /no transcript available \(bob\)/);
});

test('learn on Stop, Bob: not judged, and says so on stderr only', () => {
  const r = project({ host: 'bob' });
  assert.equal(r.rc, 0);
  assert.equal(r.out, '');
  assert.match(r.err, /\[done-gate\] no transcript \(bob\) — turn not judged\./);
  // Without a done list, Bob's Stop is exactly what it was: learn's own I2 line and nothing else.
  const off = project({ host: 'bob', checks: null });
  assert.equal(off.err.includes('[done-gate]'), false);
  assert.match(off.err, /no transcript available \(bob\)/);
});

test('rule-gate: the done list protects itself, its neighbours do not', () => {
  const sb = makeSandbox();
  try {
    const proj = path.join(sb.path, 'proj');
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
    const write = (rel) => spawnHook(['rule-gate'],
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write',
        tool_input: { file_path: path.join(proj, rel), content: 'npm test\n' } }),
      { cwd: proj, env: { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) } });
    const guarded = write('.geneseed/done-checks.txt');
    assert.equal(guarded.status, 0, guarded.stderr);
    const dec = JSON.parse(guarded.stdout).hookSpecificOutput;
    assert.equal(dec.permissionDecision, 'ask');
    assert.match(dec.permissionDecisionReason, /^This edit changes \.geneseed\/done-checks\.txt.*, which lists the checks that must pass[\s\S]*\(External Gate\)/);
    const free = write('.geneseed/notes.txt');
    assert.equal(free.status, 0);
    assert.equal(free.stdout, '', 'a neighbour of the done list must pass untouched');
  } finally { sb.cleanup(); }
});

// READ FROM THE END (constant-cost Stop). `readTail` is the byte window, `tailReader` the
// growing loop both Stop readers share. Small windows over small files stand in for the 2 MB
// window over a 50 MB transcript: the loop is the same, only `bytes` differs.
test('readTail: the window, its partial first line, and the decoding readText would do', () => {
  const sb = makeSandbox();
  try {
    const f = path.join(sb.path, 't.txt');
    const tailOf = (content, bytes) => { fs.writeFileSync(f, content); return readTail(f, bytes); };
    // Each row: the file, the window, then the text and start offset expected.
    const rows = [
      ['a file shorter than the window is read whole', 'one\ntwo\n', 100, 'one\ntwo\n', 0],
      ['a window cut mid-line drops the partial line', 'aaaa\nbbbb\ncc\n', 7, 'cc\n', 6],
      ['a window that starts exactly on a line keeps it', 'aaaa\nbbbb\n', 5, 'bbbb\n', 5],
      ['a window with no line end keeps nothing', 'aaaaaaaa', 4, '', 4],
      ['CRLF normalises like readText', 'a\r\nb\r\n', 100, 'a\nb\n', 0],
      ['a window split between \r and \n leaves only an empty line', 'aa\r\nbb\r\n', 5, '\nbb\n', 3],
      // 'é' is two bytes (0xC3 0xA9); a 5-byte window over the 7-byte file starts on its second byte.
      ['a multibyte character split by the window falls in the dropped part', 'xé\nyz\n', 5, 'yz\n', 2],
    ];
    for (const [what, content, bytes, text, start] of rows) {
      assert.deepEqual(tailOf(content, bytes), { text, start }, what);
    }
    assert.throws(() => readTail(path.join(sb.path, 'missing.jsonl'), 10), /ENOENT/);
    assert.throws(() => readTail(sb.path, 10), /EISDIR/, 'a directory must throw, never read as empty');
  } finally { sb.cleanup(); }
});

/** A transcript file: `head` rows, then filler lines worth `pad` bytes, then `tail` rows. */
function bigTranscript(dir, { head = [], pad = 0, tail = [] }) {
  const f = path.join(dir, 't.jsonl');
  const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant',
    content: [{ type: 'text', text: 'x'.repeat(1000) }] } });
  const lines = Math.ceil(pad / (filler.length + 1));
  fs.writeFileSync(f, `${[jsonl(...head), ...Array(lines).fill(filler), jsonl(...tail)]
    .filter(Boolean).join('\n')}\n`);
  return f;
}

test('tailReader: a small last turn is judged from the first window alone', () => {
  const sb = makeSandbox();
  try {
    const f = bigTranscript(sb.path, { head: [prompt('old'), edit()], pad: 200_000,
      tail: [prompt(), edit(), bash('npm run lint')] });
    const windows = [];
    const owed = tailReader(4096)(f, (text, whole) => {
      windows.push({ length: text.length, whole });
      return doneDecide(text, CHECKS, R, R, whole);
    });
    assert.deepEqual(owed, ['node --test']);
    assert.equal(windows.length, 1, 'read more than one window for a small turn');
    assert.ok(windows[0].length <= 4096 && !windows[0].whole, JSON.stringify(windows));
  } finally { sb.cleanup(); }
});

test('tailReader: a turn longer than the window still owes its checks', () => {
  // The edit sits 200 KB before the end; a judgement on the 4 KB tail would see no edit and allow.
  const sb = makeSandbox();
  try {
    const f = bigTranscript(sb.path, { head: [prompt(), edit()], pad: 200_000, tail: [bash('ls')] });
    const wholeFile = fs.readFileSync(f, 'utf8');
    assert.deepEqual(doneDecide(wholeFile, CHECKS, R), CHECKS, 'the fixture must owe both checks');
    assert.equal(doneDecide(wholeFile.slice(-4000), CHECKS, R, R, false), null,
      'a tail without a prompt must ask for more, not judge');
    assert.deepEqual(tailReader(4096)(f, (text, whole) => doneDecide(text, CHECKS, R, R, whole)),
      CHECKS);
  } finally { sb.cleanup(); }
});

test('learn on Stop: a turn longer than the 2 MB window is still blocked', () => {
  const pad = { type: 'assistant', message: { role: 'assistant',
    content: [{ type: 'text', text: 'y'.repeat(100_000) }] } };
  const r = project({ transcriptRows: [prompt(), editIn, ...Array(25).fill(pad), bash('ls')] });
  assert.equal(r.rc, 0, r.err);
  assert.equal(JSON.parse(r.out).decision, 'block');
});

// One Stop reads the transcript once: `cmdLearn` hands the same reader to the done gate and to
// `readNotes`, so the second caller must get the first one's window back, not a fresh read.
// Proven by changing the file between the two calls: a re-read would see the new line.
test('tailReader: one reader reads each window once, so two callers share it', () => {
  const sb = makeSandbox();
  try {
    const f = path.join(sb.path, 't.jsonl');
    fs.writeFileSync(f, `${jsonl(prompt('first'))}\n`);
    const read = tailReader(4096);
    const seenByGate = read(f, (text) => text);
    fs.appendFileSync(f, `${jsonl(prompt('appended after the gate read'))}\n`);
    assert.equal(read(f, (text) => text), seenByGate, 'the second caller re-read the file');
    assert.match(tailReader(4096)(f, (text) => text), /appended/, 'a new reader must see the append');
  } finally { sb.cleanup(); }
});

// ---- inferred checks (user decision 2026-10-29: the harness maintains the proof) ----------
// With no `.geneseed/done-checks.txt`, the root manifests imply the checks, each a GROUP of
// accepted forms. An inferred check never blocks: it is advisory (a `systemMessage`).

/** `inferDoneChecks` / `doneLine` over a throwaway root holding `files`. */
function inferIn(files) {
  const sb = makeSandbox();
  try {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(sb.path, rel)), { recursive: true });
      fs.writeFileSync(path.join(sb.path, rel), text);
    }
    const { sources, checks } = inferDoneChecks(sb.path);
    return { sources, labels: checks.map((c) => c.label), checks, line: doneLine(sb.path) };
  } finally { sb.cleanup(); }
}
const pkg = (scripts) => JSON.stringify({ scripts });

test('inferDoneChecks: which checks each root manifest implies', () => {
  // Each row: the root's files, then the sources and the check labels expected, in order.
  const rows = [
    ['no manifest implies nothing', { 'README.md': '# x\n' }, [], []],
    ['package.json: test, lint and typecheck, in that order, npm without a lockfile',
      { 'package.json': pkg({ typecheck: 'tsc', lint: 'eslint .', test: 'node --test', build: 'vite' }) },
      ['package.json'], ['npm test', 'npm run lint', 'npm run typecheck']],
    ['npm\'s default test script fails by design: it is no check',
      { 'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1', lint: 'eslint .' }) },
      ['package.json'], ['npm run lint']],
    ['a package.json with no usable script implies nothing', { 'package.json': pkg({ build: 'vite' }) }, [], []],
    ['an unparseable package.json implies nothing', { 'package.json': '{oops' }, [], []],
    ['pnpm-lock.yaml names pnpm', { 'package.json': pkg({ test: 'vitest' }), 'pnpm-lock.yaml': '' },
      ['package.json'], ['pnpm test']],
    ['yarn.lock names yarn', { 'package.json': pkg({ lint: 'eslint' }), 'yarn.lock': '' },
      ['package.json'], ['yarn lint']],
    ['bun.lockb names bun, and only `bun run` runs the script', { 'package.json': pkg({ test: 'x' }), 'bun.lockb': '' },
      ['package.json'], ['bun run test']],
    ['pom.xml', { 'pom.xml': '<project/>' }, ['pom.xml'], ['mvn test']],
    ['build.gradle', { 'build.gradle': '' }, ['build.gradle'], ['gradle test']],
    ['build.gradle.kts', { 'build.gradle.kts': '' }, ['build.gradle.kts'], ['gradle test']],
    // pytest only where it shows: a unittest-only or test-less repo could never clear it.
    ['a bare pyproject.toml implies nothing', { 'pyproject.toml': '[project]\nname = "x"\n' }, [], []],
    ['pyproject.toml with [tool.pytest.ini_options]',
      { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' }, ['pyproject.toml'], ['pytest']],
    ['pyproject.toml beside pytest.ini', { 'pyproject.toml': '', 'pytest.ini': '' }, ['pyproject.toml'], ['pytest']],
    ['pyproject.toml beside conftest.py', { 'pyproject.toml': '', 'conftest.py': '' }, ['pyproject.toml'], ['pytest']],
    ['pyproject.toml beside a tests/ dir', { 'pyproject.toml': '', 'tests/test_a.py': '' }, ['pyproject.toml'], ['pytest']],
    ['Cargo.toml', { 'Cargo.toml': '' }, ['Cargo.toml'], ['cargo test']],
    ['go.mod', { 'go.mod': '' }, ['go.mod'], ['go test']],
    ['several manifests: each one infers', { 'package.json': pkg({ lint: 'eslint' }), 'go.mod': '' },
      ['package.json', 'go.mod'], ['npm run lint', 'go test']],
  ];
  for (const [what, files, sources, labels] of rows) {
    const got = inferIn(files);
    assert.deepEqual(got.sources, sources, `${what}: sources`);
    assert.deepEqual(got.labels, labels, `${what}: labels`);
  }
});

test('doneLine: the SessionStart line, for each source', () => {
  const rows = [
    [{ 'package.json': pkg({ test: 'x', lint: 'y' }) },
      'Done gate: inferred from package.json — npm test, npm run lint (advisory)'],
    [{ 'README.md': '' }, 'Done gate: no checks could be inferred'],
  ];
  for (const [files, line] of rows) assert.equal(inferIn(files).line, line);
  const sb = makeSandbox();
  try {
    fs.writeFileSync(path.join(sb.path, 'package.json'), pkg({ test: 'x' }));
    fs.mkdirSync(path.join(sb.path, '.geneseed'));
    fs.writeFileSync(path.join(sb.path, '.geneseed', 'done-checks.txt'), 'make check\n');
    // The file wins over the manifest, and blocks.
    assert.equal(doneLine(sb.path), 'Done gate: from .geneseed/done-checks.txt — make check (blocking)');
    fs.writeFileSync(path.join(sb.path, '.geneseed', 'done-checks.txt'), '# opted out\n');
    assert.equal(doneLine(sb.path), 'Done gate: off — .geneseed/done-checks.txt lists no checks');
  } finally { sb.cleanup(); }
});

test('doneDecide: a group passes on any one of its forms, and owes its label', () => {
  const { checks } = inferIn({ 'package.json': pkg({ test: 'x', lint: 'y' }), 'pom.xml': '' });
  // Each row: the proof run after the edit, then the labels still owed.
  const rows = [
    ['nothing run', [], ['npm test', 'npm run lint', 'mvn test']],
    ['`npm run test` proves `npm test`', [bash('npm run test')], ['npm run lint', 'mvn test']],
    ['`npm t` proves `npm test`', [bash('npm t')], ['npm run lint', 'mvn test']],
    ['extra arguments still count', [bash('npm test -- --watch=false')], ['npm run lint', 'mvn test']],
    ['`./mvnw clean verify` proves `mvn test`', [bash('./mvnw clean verify')], ['npm test', 'npm run lint']],
    ['PowerShell spelling `.\\mvnw test`', [call('PowerShell', { command: '.\\mvnw test' })], ['npm test', 'npm run lint']],
    ['a piped form still proves nothing', [bash('npm run test | tail')], ['npm test', 'npm run lint', 'mvn test']],
    ['`npm run lint:fix` is not `npm run lint`', [bash('npm run lint:fix')], ['npm test', 'npm run lint', 'mvn test']],
    ['`mvn package` is not one of the accepted tasks', [bash('mvn package')], ['npm test', 'npm run lint', 'mvn test']],
  ];
  for (const [what, proof, owed] of rows) {
    assert.deepEqual(doneDecide(jsonl(prompt(), edit(), ...proof), checks, R), owed, what);
  }
});

test('groupPasses: a flag that skips the tests refuses the pass', () => {
  const { checks } = inferIn({ 'pom.xml': '', 'build.gradle': '', 'Cargo.toml': '' });
  const [mvn, gradle, cargo] = checks;
  // Each row: the group, the command, then whether it proves the group.
  const rows = [
    [mvn, 'mvn clean install', true],
    [mvn, 'mvn clean install -DskipTests', false],
    [mvn, './mvnw verify -Dmaven.test.skip=true', false],
    [mvn, 'mvn test -DskipTests=false', false],          // shortcut: any skipTests spelling refuses
    [mvn, 'mvn install -DskipTests; mvn test', true],      // the second segment is a clean run
    [mvn, 'mvn install -DskipTests && mvn test | tail', false],
    [mvn, 'cd core && mvn verify', true],
    [gradle, './gradlew build', true],
    [gradle, './gradlew build -x test', false],
    [gradle, 'gradle check -x=test', false],
    [gradle, 'gradle build --exclude-task :app:test', false],
    [gradle, 'gradle build -x javadoc', true],
    [cargo, 'cargo test', true],
    [cargo, 'cargo test --no-run', false],
    [cargo, 'cargo test --release', true],
  ];
  for (const [g, command, want] of rows) assert.equal(groupPasses(command, g), want, command);
});

test('learn on Stop: inferred checks are advisory — a systemMessage, never a block', () => {
  const files = { 'package.json': pkg({ test: 'node --test' }) };
  const r = project({ checks: null, files, transcriptRows: [prompt(), editIn] });
  assert.equal(r.rc, 0, r.err);
  const verdict = JSON.parse(r.out);
  assert.deepEqual(Object.keys(verdict), ['systemMessage'], 'an advisory must carry no decision');
  assert.match(verdict.systemMessage, /inferred from package\.json.*npm test/);
  assert.match(r.ledger, /"verb":"done-gate-advisory","rule":"law-3"/);
  assert.match(r.err, /\[done-gate\] advisory/);
  // With a model CLI set, learning runs after the advisory, and its answer stays off stdout:
  // a second write there would turn the JSON into text the host cannot parse.
  const learned = project({ checks: null, files, transcriptRows: [prompt(), editIn], llm: 'NOTHING' });
  assert.equal(learned.rc, 0, learned.err);
  assert.deepEqual(Object.keys(JSON.parse(learned.out)), ['systemMessage']);
  // A model CLI that fails after the advisory: its code is not the hook's. Exit 2 on Stop would
  // turn the advisory into a block, and any non-zero code drops the JSON.
  const failed = project({ checks: null, files, transcriptRows: [prompt(), editIn], llm: 'NOTHING', llmExit: 2 });
  assert.equal(failed.rc, 0, failed.err);
  assert.deepEqual(Object.keys(JSON.parse(failed.out)), ['systemMessage']);
  // The stop hook re-entry flag changes nothing for an advisory: it never blocked.
  const again = project({ checks: null, files, transcriptRows: [prompt(), editIn], active: true });
  assert.equal(JSON.parse(again.out).decision, undefined);
});

test('learn on Stop: inferred checks print nothing when proven, opted out, or not judged', () => {
  const files = { 'package.json': pkg({ test: 'node --test' }) };
  const rows = [
    ['the inferred check passed after the edit', { checks: null, files, transcriptRows: [prompt(), editIn, bash('npm run test')] }],
    ['the default npm test script is no check', { checks: null, files: { 'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1' }) }, transcriptRows: [prompt(), editIn] }],
    ['an empty done list opts the project out of inference', { checks: '# none\n', files, transcriptRows: [prompt(), editIn] }],
    ['--no-done-gate skips inference too', { checks: null, files, transcriptRows: [prompt(), editIn], extra: ['--no-done-gate'] }],
  ];
  for (const [what, opts] of rows) {
    const r = project(opts);
    assert.equal(r.rc, 0, `${what}: ${r.err}`);
    assert.equal(r.out, '', `${what}: stdout must stay empty, got ${JSON.stringify(r.out)}`);
    assert.equal(r.ledger, '', `${what}: records nothing`);
  }
  // Bob never judges, and an inferred gate does not say so: every repo with a manifest would.
  const bob = project({ host: 'bob', checks: null, files });
  assert.equal(bob.out, '');
  assert.equal(bob.err.includes('[done-gate]'), false, bob.err);
});

test('learn on Stop: the listed file wins over the manifest, and blocks', () => {
  const r = project({ checks: 'make check\n', files: { 'package.json': pkg({ test: 'x' }) },
    transcriptRows: [prompt(), editIn, bash('npm test')] });
  const verdict = JSON.parse(r.out);
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /make check/);
  assert.doesNotMatch(verdict.reason, /npm test/);
});

test('context: the done gate line reaches SessionStart, even with nothing else to load', () => {
  const sb = makeSandbox();
  try {
    const proj = path.join(sb.path, 'proj');
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'package.json'), pkg({ lint: 'eslint .' }));
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')), GENESEED_ROOT: proj };
    const bare = spawnHook(['context'], '', { cwd: proj, env });
    assert.equal(bare.status, 0, bare.stderr);
    // This package.json has no `engines`, so the runtime floor line follows, on this path too.
    assert.deepEqual(bare.stdout.trim().split(/\r?\n/), ['Done gate: inferred from package.json — npm run lint (advisory)',
      'Runtime floor: package.json declares no engines — name the supported runtime before you add a dependency or a language feature.']);
    assert.match(bare.stderr, /nothing to load/);
    fs.writeFileSync(path.join(proj, 'README.md'), '# P\n\nThe readme.\n');
    const full = spawnHook(['context'], '', { cwd: proj, env });
    assert.match(full.stdout, /^Done gate: inferred from package\.json — npm run lint \(advisory\)\r?\n/);
    assert.match(full.stdout, /The readme\./);
    // The verdict word follows the host: OpenClaude judges like Claude Code; Bob's Stop carries
    // no transcript, so the line names the checks and claims no verdict.
    const first = (host) => spawnHook(['context', '--host', host], '', { cwd: proj, env })
      .stdout.split(/\r?\n/)[0];
    assert.equal(first('openclaude'), 'Done gate: inferred from package.json — npm run lint (advisory)');
    assert.equal(first('bob'), 'Done gate: inferred from package.json — npm run lint (not judged on this host)');
    fs.mkdirSync(path.join(proj, '.geneseed'));
    fs.writeFileSync(path.join(proj, '.geneseed', 'done-checks.txt'), 'make check\n');
    assert.equal(first('openclaude'), 'Done gate: from .geneseed/done-checks.txt — make check (blocking)');
    assert.equal(first('bob'), 'Done gate: from .geneseed/done-checks.txt — make check (not judged on this host)');
  } finally { sb.cleanup(); }
});

// ---- C3: a weakened test (Cure the Cause), ADVISORY ------------------------------------

test('isTestPath: test folders and test names, and nothing near them', () => {
  const rows = [
    ['tests/a.js', true], ['test/a.js', true], ['src/__tests__/a.js', true], ['spec/a.rb', true],
    ['src\\tests\\a.js', true], ['a.test.js', true], ['src/a.spec.ts', true], ['pkg/a_test.go', true],
    ['test_a.py', true], ['pkg/test_a.py', true],
    ['src/a.js', false], ['testsuite/a.js', false], ['src/latest.js', false], ['contest_a.py', false],
    ['spec.md', false], ['src/spectacle/a.js', false], ['docs/testing.md', false],
  ];
  for (const [p, want] of rows) assert.equal(isTestPath(p), want, p);
});

test('weakenedBy: what an old and a new text do to a test', () => {
  // Each row: old text, new text, the labels. A marker counts when the new text has MORE of it. An
  // assertion counts when a line is gone and no new assertion line came in.
  const rows = [
    ["it('a', f)", "it.skip('a', f)", ['.skip added']],
    ["it('a', f)", "xit('a', f)", ['xit added']],
    ['def t(): pass', '@pytest.mark.xfail\ndef t(): pass', ['xfail added']],
    ['void t() {}', '@Disabled\nvoid t() {}', ['@Disabled added']],
    ['void t() {}', '@Ignore\nvoid t() {}', ['@Ignore added']],
    ['def t(): pass', '@pytest.mark.skip(reason="x")\ndef t(): pass', ['pytest.mark.skip added']],
    ['func T(t *testing.T) {', 'func T(t *testing.T) {\n  t.Skip("x")', ['t.Skip added']],
    // Not added: already there, moved, or a word that merely holds the letters.
    ["it.skip('a', f)", "it.skip('b', f)", []],
    ['a()', 'process.exit(1)', []],
    ['a', 'stream.Skip(1)', []],
    // A whole comment line is no marker: not added, and not lost when it is uncommented.
    ["it('a', f)", "// it.skip('a', f)\nit('a', f)", []],
    ['def t(): pass', '# @pytest.mark.skip\ndef t(): pass', []],
    [' * @Disabled', ' * @Disabled\n * xit(', []],
    ["// it.skip('a', f)", "it.skip('a', f)", ['.skip added']],
    // Known limit, the shortcut in hooks-prims.mjs: a string and any other `.skip(` still count.
    ['a', "log('it.skip(')", ['.skip added']],
    ['a', 'list.stream().skip(1)', ['.skip added']],
    // Assertions, in each spelling.
    ['a()\nexpect(a).toBe(1)\n', 'a()\n', ['assertion removed']],
    ['assert.equal(a, 1)', '', ['assertion removed']],
    ['assertEquals(a, 1);', '', ['assertion removed']],
    ['self.assertTrue(a)', '', ['assertion removed']],
    ['    assert a == 1', '', ['assertion removed']],
    ['assert_eq!(a, 1);', '', ['assertion removed']],
    ['expect(a).toBe(1)', '// expect(a).toBe(1)', ['assertion removed']],
    ['expect(a).toBe(1)\nexpect(b).toBe(2)', 'expect(a).toBe(1)', ['assertion removed']],
    // Replaced, or never one.
    ['expect(a).toBe(1)', 'expect(a).toBe(2)', []],
    ['assert a == 1', 'assert a == 2', []],
    ['expect(a).toBe(1)\nb()', 'expect(a).toBe(1)\nc()', []],
    ['// expect(a).toBe(1)', '', []],
    ['a()', 'b()', []],
  ];
  for (const [was, now, want] of rows) assert.deepEqual(weakenedBy([[was, now]]), want, `${was} -> ${now}`);
});

test('weakenedIn: which files of the turn were weakened', () => {
  const T = path.join(R, 'tests', 'a.test.js');
  const skip = (p, err = false) => call('Edit', { file_path: p, old_string: "it('a'", new_string: "it.skip('a'" }, err);
  // A Write's old text is on the result line, as the host records it (null on a create).
  const write = (p, content, originalFile) => {
    const [use, res] = call('Write', { file_path: p, content });
    return [use, { ...res, toolUseResult: { type: 'update', filePath: p, content, originalFile } }];
  };
  const rows = [
    ['a skip added to a test file', [prompt(), skip(T)], ['tests/a.test.js (.skip added)']],
    ['the same edit outside a test path', [prompt(), skip(path.join(R, 'src', 'a.js'))], []],
    ['a test file outside the project', [prompt(), skip(path.resolve('/elsewhere/tests/a.js'))], []],
    ['a denied edit changed nothing', [prompt(), skip(T, true)], []],
    ['the previous turn is not this turn', [prompt('one'), skip(T), prompt('two'), bash('ls')], []],
    ['a removed assertion', [prompt(), call('Edit', { file_path: T, old_string: 'expect(a).toBe(1)\n', new_string: '' })],
      ['tests/a.test.js (assertion removed)']],
    ['a replaced assertion', [prompt(), call('Edit', { file_path: T, old_string: 'expect(a).toBe(1)', new_string: 'expect(a).toBe(2)' })], []],
    ['two labels on one file, said once', [prompt(), skip(T), call('Edit', { file_path: T, old_string: 'assert.ok(a)', new_string: '' })],
      ['tests/a.test.js (.skip added, assertion removed)']],
    ['a Write over an old marker adds none', [prompt(), write(T, "it.skip('a')\nit('b')", "it.skip('a')")], []],
    ['a Write dropping an assertion', [prompt(), write(T, 'a()', 'a()\nexpect(a).toBe(1)')], ['tests/a.test.js (assertion removed)']],
    ['a Write creating a skipped test', [prompt(), write(T, "it.skip('a')", null)], ['tests/a.test.js (.skip added)']],
  ];
  for (const [what, turn, want] of rows) assert.deepEqual(weakenedIn(jsonl(...turn), R), want, what);
});

const weakenIn = (proj) => call('Edit', { file_path: path.join(proj, 'tests', 'a.test.js'), old_string: "it('a'", new_string: "it.skip('a'" });
const LINE = '[done-gate] advisory — test weakened this turn: tests/a.test.js (.skip added)';

test('learn on Stop: a weakened test is one advisory line, with or without checks', () => {
  // No done list and no manifest: no checks at all, the case the gate used to leave at once.
  const r = project({ checks: null, transcriptRows: [prompt(), weakenIn] });
  assert.equal(r.rc, 0, r.err);
  const doc = JSON.parse(r.out);
  assert.deepEqual(Object.keys(doc), ['systemMessage']);
  assert.ok(doc.systemMessage.startsWith(LINE), doc.systemMessage);
  assert.match(doc.systemMessage, /Cure the Cause/);
  assert.ok(r.err.includes(LINE), r.err);
  assert.match(r.ledger, /"verb":"done-gate-advisory","rule":"cure-the-cause"/);
  // A present list that lists nothing switches the checks off, not this line.
  assert.ok(JSON.parse(project({ checks: '# none\n', transcriptRows: [prompt(), weakenIn] }).out).systemMessage.startsWith(LINE));
});

test('learn on Stop: the weakened-test line shares the one JSON document with what else is said', () => {
  // Inferred checks unproven: both advisories in one systemMessage, one line of stdout.
  const inferred = project({ checks: null, files: { 'package.json': '{"scripts":{"test":"x"}}' }, transcriptRows: [prompt(), weakenIn] });
  const doc = JSON.parse(inferred.out);
  assert.match(doc.systemMessage, /inferred from package\.json/);
  assert.ok(doc.systemMessage.includes(LINE), doc.systemMessage);
  // A block: the turn goes on, so only the block is printed, and the next Stop says the line.
  const blocked = JSON.parse(project({ transcriptRows: [prompt(), weakenIn] }).out);
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.systemMessage, undefined);
  // The cap: the turn really ends here, so the line is said and nothing blocks.
  const capped = project({ active: true, transcriptRows: [prompt(), weakenIn] });
  const last = JSON.parse(capped.out);
  assert.equal(last.decision, undefined);
  assert.ok(last.systemMessage.startsWith(LINE), last.systemMessage);
  assert.match(capped.err, /cap reached/);
});

// `--no-test-note` takes the line and nothing else: `--no-done-gate` takes the checks and, with them, the line.
test('learn --no-test-note: the line goes, the done checks stay', () => {
  const extra = ['--no-test-note'];
  const quiet = project({ checks: null, extra, transcriptRows: [prompt(), weakenIn] });
  assert.equal(quiet.out, '', 'the line outlived the switch');
  assert.doesNotMatch(quiet.err, /test weakened/);
  assert.doesNotMatch(quiet.ledger, /cure-the-cause/);
  // A listed check still blocks, and the cap still ends the turn with nothing to say.
  assert.equal(JSON.parse(project({ extra, transcriptRows: [prompt(), weakenIn] }).out).decision, 'block');
  assert.equal(project({ active: true, extra, transcriptRows: [prompt(), weakenIn] }).out, '');
  // An inferred check still advises, without the line.
  const inferred = JSON.parse(project({ checks: null, extra, files: { 'package.json': '{"scripts":{"test":"x"}}' },
    transcriptRows: [prompt(), weakenIn] }).out);
  assert.match(inferred.systemMessage, /inferred from package\.json/);
  assert.ok(!inferred.systemMessage.includes(LINE), inferred.systemMessage);
});

test('learn on Stop: no weakened test prints nothing; --no-done-gate and Bob say nothing either', () => {
  assert.equal(project({ checks: null, transcriptRows: [prompt(), editIn] }).out, '', 'an ordinary edit');
  assert.equal(project({ checks: null, extra: ['--no-done-gate'], transcriptRows: [prompt(), weakenIn] }).out, '');
  assert.equal(project({ checks: null, host: 'bob', transcriptRows: [prompt(), weakenIn] }).out, '', 'Bob has no transcript');
});

// ---- SubagentStop: the sub-agent's own turn ----------------------------------------------
// A sub-agent's transcript (`agent_transcript_path`) marks every message line `isSidechain: true`
// — the Agent call's prompt included — so it is read in sidechain mode, and the projects judged
// are the git roots of the files it wrote, not the parent's cwd.

/** Transcript rows as a sub-agent's transcript holds them: the same lines, `isSidechain: true`. */
const side = (rows) => rows.flat().map((o) => ({ ...o, isSidechain: true }));

test('doneDecide: a sub-agent transcript is judged only in sidechain mode', () => {
  const reminder = { type: 'user', isMeta: true, isSidechain: true,
    message: { role: 'user', content: '<system-reminder>report through SubagentHandback</system-reminder>' } };
  const t = jsonl(side([prompt('the brief'), reminder, edit(), bash('npm run lint')]));
  assert.deepEqual(doneDecide(t, CHECKS, R, R, true, false), [], 'main mode reads no line of it: nothing judged');
  assert.deepEqual(doneDecide(t, CHECKS, R, R, true, true), ['node --test'],
    'sidechain mode: the brief opens the turn, the isMeta reminder does not, lint passed after the edit');
  // A main transcript is unchanged: its sidechain lines are still not its own.
  assert.deepEqual(doneDecide(jsonl(prompt(), edit(), side([bash('npm run lint')])), CHECKS, R), CHECKS);
});

/**
 * One SubagentStop through the real binary. The parent sits in `parent/` (a git root); the worker
 * in `parent/.claude/worktrees/w`, its own git root (a `.git` FILE, as a worktree has), with
 * `workerChecks` as its list (null: none) and `workerFiles` beside it. `stops` is a list of
 * `{ rows, active }`: each stop rewrites the transcript, all share one install (S5's state).
 */
function subagentStops({ stops, workerChecks = 'npm run lint\n', workerFiles = {}, parentChecks = null,
  withPath = true, llm = false, event = 'SubagentStop' }) {
  const sb = makeSandbox();
  try {
    const parent = path.join(sb.path, 'parent');
    const worker = path.join(parent, '.claude', 'worktrees', 'w');
    fs.mkdirSync(path.join(parent, '.git'), { recursive: true });
    fs.mkdirSync(worker, { recursive: true });
    fs.writeFileSync(path.join(worker, '.git'), 'gitdir: ../../../.git/worktrees/w\n');
    for (const [rel, text] of Object.entries(workerFiles)) fs.writeFileSync(path.join(worker, rel), text);
    const list = (dir, text) => {
      if (text === null) return;
      fs.mkdirSync(path.join(dir, '.geneseed'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.geneseed', 'done-checks.txt'), text);
    };
    list(worker, workerChecks);
    list(parent, parentChecks);
    const install = path.join(sb.path, 'install');
    fs.mkdirSync(path.join(install, 'notebook'), { recursive: true });
    fs.mkdirSync(path.join(install, 'memory'), { recursive: true });   // where an agent lesson lands
    const transcript = path.join(sb.path, 'agent-w.jsonl');
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) };
    delete env.GENESEED_LLM;
    delete env.GENESEED_LEARN_CHILD;
    if (llm) {
      const stub = path.join(sb.path, 'llm.mjs');
      fs.writeFileSync(stub, 'process.stdout.write("Always run the listed checks before handing back.");\n');
      env.GENESEED_LLM = `node ${stub}`;
    }
    const ledgerFile = path.join(install, 'notebook', 'gates.jsonl');
    return stops.map(({ rows, active = false }) => {
      const resolved = rows.map((r) => (typeof r === 'function' ? r(worker) : r));
      fs.writeFileSync(transcript, jsonl(...(event === 'Stop' ? resolved : side(resolved))));
      const payload = event === 'Stop'
        ? { hook_event_name: 'Stop', session_id: 's', cwd: worker, transcript_path: transcript, stop_hook_active: active }
        : { hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'w', agent_type: 'developer',
        cwd: parent, transcript_path: path.join(sb.path, 'parent.jsonl'), stop_hook_active: active,
        ...(withPath ? { agent_transcript_path: transcript } : {}) };
      const p = spawnHook(['learn', '--memory', path.join(install, 'memory')], JSON.stringify(payload), { cwd: parent, env });
      const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : '';
      if (fs.existsSync(ledgerFile)) fs.unlinkSync(ledgerFile);
      const lesson = fs.existsSync(path.join(install, 'memory', 'agents', 'developer.md'));
      return { rc: p.status, out: p.stdout, err: p.stderr, ledger, lesson };
    });
  } finally {
    sb.cleanup();
  }
}
const subagentStop = ({ rows = [], active = false, ...opts } = {}) => subagentStops({ ...opts, stops: [{ rows, active }] })[0];
const editWorker = (w) => edit(path.join(w, 'a.js'));

test('learn on SubagentStop: the worker\'s own root and list judge its turn', () => {
  const r = subagentStop({ rows: [prompt('brief'), editWorker] });
  assert.equal(r.rc, 0, r.err);
  const verdict = JSON.parse(r.out);
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /this sub-agent edited files/);
  assert.match(verdict.reason, /npm run lint/);
  assert.match(r.ledger, /"verb":"done-gate","rule":"law-3"/);

  // Proven after the edit: nothing on stdout, nothing in the ledger.
  const ok = subagentStop({ rows: [prompt('brief'), editWorker, bash('npm run lint')] });
  assert.equal(ok.out, '', ok.err);
  assert.equal(ok.ledger, '');

  // The parent's list is not the worker's: the worker's write owes the parent's check nothing.
  const parentOnly = subagentStop({ workerChecks: null, parentChecks: 'npm run typecheck\n',
    rows: [prompt('brief'), editWorker] });
  assert.equal(parentOnly.out, '', parentOnly.err);
  assert.equal(parentOnly.ledger, '');
});

test('learn on SubagentStop: a block returns before the agent lesson is distilled', () => {
  const blocked = subagentStop({ rows: [prompt('brief'), editWorker], llm: true });
  assert.equal(JSON.parse(blocked.out).decision, 'block');
  assert.equal(blocked.lesson, false, 'a blocked sub-agent got a lesson written');
  const proven = subagentStop({ rows: [prompt('brief'), editWorker, bash('npm run lint')], llm: true });
  assert.equal(proven.lesson, true, `the allowed sub-agent learned nothing: ${proven.err}`);
});

test('learn on SubagentStop: an inferred check is a stderr line and a ledger entry, never stdout', () => {
  const r = subagentStop({ workerChecks: null, workerFiles: { 'package.json': '{"scripts":{"test":"x"}}' },
    rows: [prompt('brief'), editWorker] });
  assert.equal(r.rc, 0);
  assert.equal(r.out, '', 'nobody reads a sub-agent\'s systemMessage: stdout must stay empty');
  assert.match(r.err, /\[done-gate\] advisory \(sub-agent\) — unproven since the last edit: npm test/);
  assert.match(r.ledger, /"rule":"law-3"/);
});

test('learn on SubagentStop: no agent transcript is not judged, said only where a list exists', () => {
  const listed = subagentStop({ withPath: false, parentChecks: 'npm run lint\n', rows: [prompt(), editWorker] });
  assert.equal(listed.out, '');
  assert.match(listed.err, /\[done-gate\] no agent transcript — sub-agent turn not judged\./);
  const quiet = subagentStop({ withPath: false, rows: [prompt(), editWorker] });
  assert.equal(quiet.err.includes('[done-gate]'), false, quiet.err);
});

// ---- the block cap: a repeat block needs a new edit, and stops at 3 per turn -----------------

test('nextBlock: the cap, written out', () => {
  const T = 'turn-1';
  // Each row: the saved state, the Stop, then the state saved with a block (null: the turn ends).
  const rows = [
    ['first stop, no record: block, count 1',
      null, { active: false, opening: T, lastEdit: 'e1' }, { opening: T, lastEdit: 'e1', blocks: 1 }],
    ['a stop after a block we have no record of: ends, as before the cap',
      null, { active: true, opening: T, lastEdit: 'e1' }, null],
    ['second stop, no new edit: ends',
      { opening: T, lastEdit: 'e1', blocks: 1 }, { active: true, opening: T, lastEdit: 'e1' }, null],
    ['second stop, a new edit: blocks again, count 2',
      { opening: T, lastEdit: 'e1', blocks: 1 }, { active: true, opening: T, lastEdit: 'e2' },
      { opening: T, lastEdit: 'e2', blocks: 2 }],
    ['third stop, a new edit: blocks, count 3',
      { opening: T, lastEdit: 'e2', blocks: 2 }, { active: true, opening: T, lastEdit: 'e3' },
      { opening: T, lastEdit: 'e3', blocks: 3 }],
    ['fourth stop, even with a new edit: ends',
      { opening: T, lastEdit: 'e3', blocks: 3 }, { active: true, opening: T, lastEdit: 'e4' }, null],
    // The record decides once it exists, whatever the flag says.
    ['a record with the flag cleared and no new edit: ends',
      { opening: T, lastEdit: 'e1', blocks: 1 }, { active: false, opening: T, lastEdit: 'e1' }, null],
    // Another opening prompt is another turn: the old record counts as none.
    ['a new turn after a capped one: block, count 1',
      { opening: T, lastEdit: 'e3', blocks: 3 }, { active: false, opening: 'turn-2', lastEdit: 'e9' },
      { opening: 'turn-2', lastEdit: 'e9', blocks: 1 }],
    ['a new turn with the flag set and no record of it: ends',
      { opening: T, lastEdit: 'e1', blocks: 1 }, { active: true, opening: 'turn-2', lastEdit: 'e9' }, null],
  ];
  for (const [what, state, stop, want] of rows) assert.deepEqual(nextBlock(state, stop), want, what);
});

/** A row factory that builds its rows once, so every Stop of a sequence sees the same tool ids. */
const once = (f) => { let v; return (w) => (v ??= f(w)); };

test('learn on Stop: the cap across real Stops of one session', () => {
  const ed = [once(editWorker), once(editWorker), once(editWorker), once(editWorker)];
  const p1 = { uuid: 'p1', ...prompt('one') };
  const verdicts = (stops) => subagentStops({ event: 'Stop', stops }).map((r) => {
    assert.equal(r.rc, 0, r.err);
    return r.out ? JSON.parse(r.out).decision : (/"verb":"done-gate-cap"/.test(r.ledger) ? 'cap' : `none: ${r.err}`);
  });
  // Second stop with no new edit ends the turn, with the cap's ledger line.
  assert.deepEqual(verdicts([
    { rows: [p1, ed[0]] },
    { rows: [p1, ed[0], bash('ls')], active: true },
  ]), ['block', 'cap']);
  // A new edit before each stop: blocks three times, then the fourth stop ends the turn.
  // A new prompt is a new turn, and blocks again.
  const e = [once(editWorker), once(editWorker), once(editWorker), once(editWorker), once(editWorker)];
  const p2 = { uuid: 'p2', ...prompt('two') };
  assert.deepEqual(verdicts([
    { rows: [p1, e[0]] },
    { rows: [p1, e[0], e[1]], active: true },
    { rows: [p1, e[0], e[1], e[2]], active: true },
    { rows: [p1, e[0], e[1], e[2], e[3]], active: true },
    { rows: [p1, e[0], e[1], e[2], e[3], p2, e[4]] },
  ]), ['block', 'block', 'block', 'cap', 'block']);
});

test('learn on SubagentStop: the cap counts per sub-agent', () => {
  const e = [once(editWorker), once(editWorker)];
  const runs = subagentStops({ stops: [
    { rows: [prompt('brief'), e[0]] },
    { rows: [prompt('brief'), e[0]], active: true },
    { rows: [prompt('brief'), e[0], e[1]], active: true },
  ] });
  assert.deepEqual(runs.map((r) => (r.out ? JSON.parse(r.out).decision : r.ledger.includes('done-gate-cap') ? 'cap' : '?')),
    ['block', 'cap', 'block']);
});
