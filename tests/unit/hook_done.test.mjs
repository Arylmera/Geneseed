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

import { doneDecide, groupPasses, runsUnpiped } from '../../js/hosts/hooks-done.mjs';
import { doneLine, inferDoneChecks } from '../../js/hosts/done-checks.mjs';
import { tailReader } from '../../js/hosts/hooks-prims.mjs';
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
    assert.match(dec.permissionDecisionReason, /External Gate.*the done gate list itself/);
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
    assert.equal(bare.stdout.trim(), 'Done gate: inferred from package.json — npm run lint (advisory)');
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
