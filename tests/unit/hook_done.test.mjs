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

import { doneDecide, runsUnpiped } from '../../js/hosts/hooks-done.mjs';
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
    ['`||` is not a pipe', [prompt(), edit(), bash('npm run lint || true; node --test')], []],
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
    ['npm test || exit 1', 'npm test', true],
    ['npm test | tail; npm test', 'npm test', true],        // one unpiped run is enough
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
function project({ checks = 'npm run lint\n', transcriptRows = [], host = null, active = false } = {}) {
  const sb = makeSandbox();
  const proj = path.join(sb.path, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
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
  try {
    const argv = ['learn', '--memory', path.join(install, 'memory'), ...(host ? ['--host', host] : [])];
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
