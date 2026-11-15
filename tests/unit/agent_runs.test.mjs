// The agent outcome ledger (js/hosts/agent-runs.mjs writes it on SubagentStop, js/inspect/
// agent-scores.mjs reads it for `geneseed catalog agents --scores`). Every expected value is
// written out below, with the rule it follows said above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import {
  agentRunLine, blocksOf, isRefusal, recordAgentRun, runCounts, specHashOf, specOf, RUNS_LEDGER,
} from '../../js/hosts/agent-runs.mjs';
import { cmdLearn } from '../../js/hosts/hooks-learn.mjs';
import { cmdAgentScores, readRuns, scoreLines, scoreRows } from '../../js/inspect/agent-scores.mjs';

const withDir = async (fn) => {
  const sb = makeSandbox('agentruns-');
  try { return await fn(sb.path); } finally { sb.cleanup(); }
};
const DAY = new Date('2026-11-14T12:00:00Z');

// ---- the refusal markers ---------------------------------------------------------------------
// A refusal is a call the host or a gate did not run. A red test, a missing file or any other
// non-zero exit is an error, NOT a refusal: those rows must stay false, or every red suite run
// would read as a refused call.
const REFUSALS = [
  ['Tell the user this, word for word: This command deletes files that git cannot restore.', true],
  ['PreToolUse:Bash hook returned: Tell the user this, word for word: This edit writes to x.', true],
  ['Geneseed could not describe this call. Check what it does before you trust it.', true],
  ['Permission for this action was denied by the Claude Code auto mode classifier. Reason: x', true],
  ['This agent is isolated in the worktree C:\\w, but this command names git in a form too complex to verify that it stays inside the worktree. Refusing to run it — a worktree-isolated agent must target its own worktree.', true],
  ['Permission to use Bash with command rm -rf build has been denied.', true],
  ["The user doesn't want to proceed with this tool use. The tool use was rejected.", true],
  // The renamed V2 call is read through core's error text (above), never its bare name.
  ['BLOCKED, not a missing tool: the guard refused this call', false],
  ['[geneseed-guard] blocked: the guard refused this call', true],
  ['No tool named "BLOCKED, not a missing tool: the guard refused this call"', true],
  // Geneseed's words count behind a host prefix of at most 80 characters, not deeper in a line.
  ['Error: the assertion at tests/unit/hook_gates.test.mjs line 412 failed comparing the gate output: Tell the user this, word for word: x', false],
  // A red test or a search that QUOTES a gate's text further down is an error, not a refusal.
  ['Exit code 1\nnot ok 4 - gate text\n  expected: "Tell the user this, word for word: ..."', false],
  ['Exit code 2\nrg: x: No such file\nsrc/a.mjs: // Refusing to run it here', false],
  ['Exit code 1\nGeneseed could not describe this call. (quoted by a test)', false],
  ['Exit code 1\nnot ok 3 - the suite is red', false],
  ['File does not exist.', false],
  ['Error: ENOENT: no such file or directory', false],
  ['the log said: permission for this action was denied', false],
  ['', false],
];

test('isRefusal: a refused call is one of the listed texts, an error exit is not', () => {
  for (const [text, want] of REFUSALS) assert.equal(isRefusal(text), want, text);
  assert.equal(isRefusal(null), false);
});

// ---- the spec hash and the line --------------------------------------------------------------
// The hash is sha256 over the text with CRLF folded to LF, cut to 12 hex: the hook and the
// OpenCode plugin must name the same spec whatever line endings the checkout wrote.
test('specHashOf: 12 hex of sha256 over LF text, the same for CRLF', () => {
  assert.equal(specHashOf('a\n'), '87428fc52280');
  assert.equal(specHashOf('a\r\n'), '87428fc52280');
  assert.equal(specHashOf('b\n'), '0263829989b6');
});

// Field order is fixed; an absent count is null, `feedback` 0 and `report` false.
test('agentRunLine: the day in UTC, every field in order', () => {
  assert.equal(agentRunLine({ agent: 'developer', spec: 'abc', done: 'ended', blocks: 1, tools: 4, refused: 2,
    feedback: 1, report: true }, DAY),
  '{"ts":"2026-11-14","agent":"developer","spec":"abc","done":"ended","blocks":1,"tools":4,"refused":2,"feedback":1,"report":true}\n');
  assert.equal(agentRunLine({ agent: 'tester' }, new Date('2026-11-14T23:59:59Z')),
    '{"ts":"2026-11-14","agent":"tester","spec":null,"done":null,"blocks":null,"tools":null,"refused":null,"feedback":0,"report":false}\n');
});

// ---- the transcript counts -------------------------------------------------------------------
let n = 0;
function call(name, input, isError = false, content = undefined) {
  n += 1;
  const id = `c${n}`;
  return [
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError,
      ...(content === undefined ? {} : { content }) }] } },
  ];
}
const brief = (text, uuid) => ({ type: 'user', isSidechain: true, ...(uuid ? { uuid } : {}), message: { role: 'user', content: text } });
const jsonl = (...rows) => rows.flat().map((o) => JSON.stringify(o)).join('\n');
const DENIED = 'Permission for this action was denied by the Claude Code auto mode classifier.';

// The counts are the CURRENT turn's: a resumed sub-agent's earlier turn is not counted again. An
// isMeta reminder, a task notification and a hook's feedback open no turn. `opening` is the
// prompt's uuid, else its content, the key the done gate's cap state carries.
test('runCounts: the current turn\'s calls and refusals, keyed by its opening', () => {
  const meta = { type: 'user', isMeta: true, isSidechain: true, message: { role: 'user', content: '<system-reminder>x</system-reminder>' } };
  const note = brief('<task-notification>\n<task-id>b1</task-id>\n</task-notification>');
  const feedback = brief('SubagentStop hook feedback:\nGeneseed (Verify Before Asserting) — run the checks');
  const rows = [
    ['one turn: three calls, one refused, one red test (not a refusal)',
      [brief('the brief', 'u1'), meta, call('Read', {}), call('Bash', { command: 'git x' }, true, DENIED),
        call('Bash', { command: 'npm test' }, true, [{ type: 'text', text: 'Exit code 1' }])],
      { tools: 3, refused: 1, opening: 'u1' }],
    ['a notification and a block\'s feedback stay inside the turn',
      [brief('the brief', 'u1'), call('Edit', {}), note, feedback, call('Bash', {}, true, DENIED)],
      { tools: 2, refused: 1, opening: 'u1' }],
    ['a resumed sub-agent: only the second turn counts',
      [brief('one', 'u1'), call('Read', {}), call('Read', {}), brief('two', 'u2'), call('Grep', {})],
      { tools: 1, refused: 0, opening: 'u2' }],
    ['a prompt with no uuid is keyed by its content',
      [brief('go'), call('Read', {})], { tools: 1, refused: 0, opening: '"go"' }],
    ['no prompt in the whole file: everything counts, opening empty',
      [call('Read', {})], { tools: 1, refused: 0, opening: '' }],
  ];
  for (const [what, transcript, want] of rows) assert.deepEqual(runCounts(jsonl(...transcript), true), want, what);
  assert.equal(runCounts(jsonl(call('Read', {})), false), null, 'a tail with no prompt reads further back');
});

// ---- the spec of an agent ----------------------------------------------------------------------
// A spec is hashed only when the install's manifest owns `agents/<name>.md`: a builtin agent and
// a user's own file there are not Geneseed's spec, so they read null.
function install(d, { agents = { developer: '# developer\r\nspec text\r\n' }, owned = ['agents/developer.md'] } = {}) {
  const cfg = path.join(d, 'cfg');
  fs.mkdirSync(path.join(cfg, 'notebook'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'agents'), { recursive: true });
  for (const [name, text] of Object.entries(agents)) fs.writeFileSync(path.join(cfg, 'agents', `${name}.md`), text);
  fs.writeFileSync(path.join(cfg, '.geneseed-manifest.json'), JSON.stringify({ owned }));
  return cfg;
}
const DEV_SPEC = specHashOf('# developer\nspec text\n');

test('specOf: the hash of an owned spec, null for any other agent', async () => {
  await withDir((d) => {
    const cfg = install(d, { agents: { developer: '# developer\r\nspec text\r\n', mine: 'x' } });
    assert.equal(specOf(cfg, 'developer'), DEV_SPEC);
    assert.equal(specOf(cfg, 'mine'), null, 'a file the manifest does not own');
    assert.equal(specOf(cfg, 'general-purpose'), null, 'no file at all');
    assert.equal(specOf(path.join(d, 'nowhere'), 'developer'), null, 'no manifest');
  });
});

// ---- the write -------------------------------------------------------------------------------
const lines = (cfg) => {
  try { return fs.readFileSync(path.join(cfg, RUNS_LEDGER), 'utf8').split('\n').filter(Boolean); } catch { return []; }
};
async function inEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// Off when GENESEED_NO_USAGE is set, when `.usage-off` exists, when the notebook is missing (never
// created) or the agent is unnamed. Otherwise one line, read off the transcript and the report.
test('recordAgentRun: one line when on, none when switched off or with nowhere to go', async () => {
  await withDir(async (d) => {
    const cfg = install(d);
    const t = path.join(d, 't.jsonl');
    fs.writeFileSync(t, jsonl(brief('b', 'u1'), call('Read', {}), call('Bash', {}, true, DENIED)));
    const read = (f, judge) => judge(fs.readFileSync(f, 'utf8'), true);
    const meta = { agent_transcript_path: t, session_id: 's', agent_id: 'a' };
    const report = 'done.\nspec-feedback: [agent] name the base ref in the brief — seen: a guess';
    await inEnv({ GENESEED_NO_USAGE: '1' }, () => recordAgentRun(cfg, 'developer', meta, { done: 'ended', report, read }, DAY));
    assert.deepEqual(lines(cfg), [], 'GENESEED_NO_USAGE');
    await inEnv({ GENESEED_NO_USAGE: undefined }, async () => {
      fs.writeFileSync(path.join(cfg, '.usage-off'), '');
      recordAgentRun(cfg, 'developer', meta, { done: 'ended', report, read }, DAY);
      assert.deepEqual(lines(cfg), [], '.usage-off');
      fs.unlinkSync(path.join(cfg, '.usage-off'));
      recordAgentRun(cfg, null, meta, { done: 'ended', report, read }, DAY);
      assert.deepEqual(lines(cfg), [], 'unnamed');
      recordAgentRun(cfg, 'developer', meta, { done: 'ended', report, read }, DAY);
      assert.deepEqual(lines(cfg), [
        `{"ts":"2026-11-14","agent":"developer","spec":"${DEV_SPEC}","done":"ended","blocks":0,"tools":2,"refused":1,"feedback":1,"report":true}`]);
      // No transcript: no counts, and `blocks` only for a judged run.
      recordAgentRun(cfg, 'explorer', {}, { done: 'not-judged', report: '' }, DAY);
      assert.equal(lines(cfg)[1],
        '{"ts":"2026-11-14","agent":"explorer","spec":null,"done":"not-judged","blocks":null,"tools":null,"refused":null,"feedback":0,"report":false}');
      fs.rmSync(path.join(cfg, 'notebook'), { recursive: true });
      recordAgentRun(cfg, 'developer', meta, { done: 'ended', report, read }, DAY);
      assert.equal(fs.existsSync(path.join(cfg, 'notebook')), false, 'the notebook is never created');
    });
  });
});

// The cap state the done gate writes is read only when it is THIS turn's: another opening (an
// earlier turn of a resumed sub-agent) counts no block.
test('blocksOf: the gate\'s total for this turn, 0 for another turn or no state', async () => {
  await withDir((d) => {
    const dir = path.join(d, 'notebook', 'done-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 's~a_b.json'), JSON.stringify({ opening: 'u1', blocks: 2, total: 3 }));
    const meta = { session_id: 's', agent_id: 'a:b' };
    assert.equal(blocksOf(d, meta, 'u1'), 3);
    assert.equal(blocksOf(d, meta, 'u2'), 0);
    assert.equal(blocksOf(d, { session_id: 's', agent_id: 'other' }, 'u1'), 0);
    assert.equal(blocksOf(null, meta, 'u1'), 0);
  });
});

// Parallel sub-agents end together and append to one file. Each line is one O_APPEND write, as
// usage.jsonl is, with no lock: this checks that 12 processes at once leave 12 whole, parseable
// lines. It is a whole-lines check, not a lock proof (an append of one short line is whole anyway).
test('recordAgentRun: 12 hooks at once write 12 whole lines', async () => {
  const { spawn } = await import('node:child_process');
  await withDir(async (d) => {
    const cfg = install(d);
    const go = path.join(d, 'go');
    const mod = pathToFileURL(path.resolve('js/hosts/agent-runs.mjs')).href;
    const script = `const fs = await import('node:fs');
const { recordAgentRun } = await import(${JSON.stringify(mod)});
while (!fs.existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 2));
recordAgentRun(${JSON.stringify(cfg)}, 'developer', {}, { done: null, report: 'r' + process.argv[1] });`;
    const N = 12;
    const env = { ...process.env };
    delete env.GENESEED_NO_USAGE;
    const runs = Array.from({ length: N }, (_, i) => new Promise((resolve) => {
      spawn(process.execPath, ['--input-type=module', '-e', script, String(i)], { stdio: 'ignore', env }).on('exit', resolve);
    }));
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(go, '');
    await Promise.all(runs);
    const got = lines(cfg);
    assert.equal(got.length, N, got.join('\n'));
    for (const l of got) assert.equal(JSON.parse(l).agent, 'developer', l);
    assert.deepEqual(fs.readdirSync(path.join(cfg, 'notebook')).sort(), ['agent-runs.jsonl'], 'nothing but the ledger');
  });
});

// ---- through cmdLearn and the real hook binary -------------------------------------------------
// `--file` is a manual run: the gate does not run, so `done` is null.
test('cmdLearn: a manual SubagentStop run records done null', async () => {
  await withDir(async (d) => {
    const cfg = install(d);
    const t = path.join(d, 't.jsonl');
    fs.writeFileSync(t, jsonl(brief('b', 'u1'), call('Read', {})));
    const file = path.join(d, 'payload.json');
    fs.writeFileSync(file, JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's', agent_type: 'developer',
      agent_transcript_path: t }));
    await inEnv({ GENESEED_LLM: undefined, GENESEED_NO_USAGE: undefined, GENESEED_LEARN_CHILD: undefined,
      XDG_CONFIG_HOME: path.join(d, 'xdg'), CLAUDE_PROJECT_DIR: d },
    () => cmdLearn({ memory: path.join(cfg, 'memory'), host: 'claude', file }));
    assert.equal(lines(cfg).length, 1);
    assert.deepEqual(JSON.parse(lines(cfg)[0]), { ts: JSON.parse(lines(cfg)[0]).ts, agent: 'developer', spec: DEV_SPEC,
      done: null, blocks: null, tools: 1, refused: 0, feedback: 0, report: false });
  });
});

/**
 * SubagentStops through `bin/geneseed-hook.mjs learn`, stdin on fd 0. The worker is its own git
 * root with `npm run lint` listed, so an unproven edit blocks. Each stop rewrites the transcript.
 */
function hookStops(stops) {
  const sb = makeSandbox('agentruns-hook-');
  try {
    const parent = path.join(sb.path, 'parent');
    const worker = path.join(parent, 'w');
    fs.mkdirSync(path.join(parent, '.git'), { recursive: true });
    fs.mkdirSync(path.join(worker, '.geneseed'), { recursive: true });
    fs.writeFileSync(path.join(worker, '.git'), 'gitdir: ../.git/worktrees/w\n');
    fs.writeFileSync(path.join(worker, '.geneseed', 'done-checks.txt'), 'npm run lint\n');
    const cfg = install(sb.path);
    const transcript = path.join(sb.path, 'agent.jsonl');
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) };
    for (const k of ['GENESEED_LLM', 'GENESEED_LEARN_CHILD', 'GENESEED_NO_USAGE']) delete env[k];
    const out = stops.map(({ rows, active = false }) => {
      fs.writeFileSync(transcript, jsonl(...rows.map((r) => (typeof r === 'function' ? r(worker) : r))));
      const payload = { hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'w1', agent_type: 'developer',
        cwd: parent, transcript_path: path.join(sb.path, 'parent.jsonl'), agent_transcript_path: transcript,
        stop_hook_active: active };
      const p = spawnHook(['learn', '--memory', path.join(cfg, 'memory')], JSON.stringify(payload), { cwd: parent, env });
      return { rc: p.status, out: p.stdout, err: p.stderr, lines: lines(cfg) };
    });
    return out;
  } finally { sb.cleanup(); }
}
const editIn = (w) => call('Edit', { file_path: path.join(w, 'a.js') });

test('learn hook: a finished sub-agent is one line, silent on stdout; a blocked stop writes none', () => {
  const report = { type: 'assistant', isSidechain: true, message: { id: 'fin', role: 'assistant',
    content: [{ type: 'text', text: 'Done.\nspec-feedback: [agent] name the base ref in the brief — seen: a guess' }] } };
  const [clean] = hookStops([{ rows: [brief('brief', 'u1'), call('Read', {}), report] }]);
  assert.equal(clean.rc, 0, clean.err);
  assert.equal(clean.out, '', 'zero stdout bytes');
  assert.equal(clean.lines.length, 1, clean.err);
  const line = JSON.parse(clean.lines[0]);
  assert.deepEqual({ ...line, ts: 'day' }, { ts: 'day', agent: 'developer', spec: DEV_SPEC, done: 'ended', blocks: 0,
    tools: 1, refused: 0, feedback: 1, report: true });

  // Blocked once, then proven: the block writes no line, the end writes one with blocks 1. This is
  // also the pin on `blocksOf`'s copy of the cap file's path: drift there reads 0 here.
  const [blocked, ended] = hookStops([
    { rows: [brief('brief', 'u1'), editIn] },
    { rows: [brief('brief', 'u1'), editIn, call('Bash', { command: 'npm run lint' })], active: true },
  ]);
  assert.equal(JSON.parse(blocked.out).decision, 'block');
  assert.deepEqual(blocked.lines, [], 'a blocked stop is not a finished run');
  assert.equal(ended.out, '', ended.err);
  assert.equal(ended.lines.length, 1);
  assert.deepEqual({ ...JSON.parse(ended.lines[0]), ts: 'day' }, { ts: 'day', agent: 'developer', spec: DEV_SPEC,
    done: 'ended', blocks: 1, tools: 2, refused: 0, feedback: 0, report: false });
});

// ---- the read side ---------------------------------------------------------------------------
// One row per agent and spec, agents by name, each agent's specs oldest first. UNBLOCKED is
// `never blocked / judged`, over the judged (`done: "ended"`) runs only, as REPORTS is a count over
// runs. REFUSED and TOOLS are means over the runs that carry a count, with that count in brackets,
// and `-` below 3 such runs: one or two runs make no mean worth comparing.
const RUNS = [
  { ts: '2026-11-09', agent: 'tester', spec: 'aaa', done: 'ended', blocks: 0, tools: 4, refused: 0, feedback: 0, report: true },
  { ts: '2026-11-10', agent: 'developer', spec: 'old', done: 'ended', blocks: 2, tools: 10, refused: 3, feedback: 1, report: true },
  { ts: '2026-11-11', agent: 'developer', spec: 'old', done: 'ended', blocks: 0, tools: 20, refused: 0, feedback: 0, report: false },
  { ts: '2026-11-12', agent: 'developer', spec: 'old', done: 'ended', blocks: 0, tools: 30, refused: 0, feedback: 0, report: true },
  { ts: '2026-11-13', agent: 'developer', spec: 'new', done: 'ended', blocks: 0, tools: 5, refused: 0, feedback: 0, report: true },
  { ts: '2026-11-14', agent: 'developer', spec: 'new', done: null, blocks: null, tools: null, refused: null, feedback: 2, report: true },
  { ts: '2026-11-14', agent: 'explore', spec: null, done: 'not-judged', blocks: null, tools: null, refused: null, feedback: 0, report: true },
];
const TABLE = [
  'AGENT      SPEC  RUNS  UNBLOCKED  REFUSED  TOOLS     FEEDBACK  REPORTS  SINCE       LAST',
  'developer  old   3     2/3        1.0 (3)  20.0 (3)  1         2/3      2026-11-10  2026-11-12',
  'developer  new   2     1/1        -        -         2         2/2      2026-11-13  2026-11-14',
  'explore    -     1     -          -        -         0         1/1      2026-11-14  2026-11-14',
  'tester     aaa   1     1/1        -        -         0         1/1      2026-11-09  2026-11-09',
];

test('scoreRows + scoreLines: the per-agent, per-spec table', () => {
  assert.deepEqual(scoreLines(scoreRows(RUNS)), TABLE);
});

test('readRuns: a garbage or torn line is skipped', async () => {
  await withDir((d) => {
    const f = path.join(d, 'r.jsonl');
    fs.writeFileSync(f, `${JSON.stringify(RUNS[0])}\nnot json\n{"ts":1}\n{"ts":"2026-11-14","agent":"x"`);
    assert.deepEqual(readRuns(f), [RUNS[0]]);
    assert.deepEqual(readRuns(path.join(d, 'none.jsonl')), []);
  });
});

// `--scores` scores agents only, so the command line must name the agents section: none, or any
// other, is refused with exit 2 and one stderr line, before any install is read.
test('catalog --scores: refused without the agents section', async () => {
  const { cmdCatalog } = await import('../../js/build/catalog.mjs');
  const said = [];
  const write = process.stderr.write;
  process.stderr.write = (s) => { said.push(String(s)); return true; };
  let rcs;
  try { rcs = [await cmdCatalog({ scores: true }), await cmdCatalog({ scores: true, section: 'skills' })]; }
  finally { process.stderr.write = write; }
  assert.deepEqual(rcs, [2, 2]);
  assert.deepEqual(said.join('').replace(/\r\n/g, '\n').split('\n').filter(Boolean),
    Array(2).fill('[catalog] --scores reads agent runs: use `geneseed catalog agents --scores`.'));
});

test('cmdAgentScores: one table per install with a ledger, read-only', async () => {
  await withDir(async (d) => {
    const root = path.join(d, 'proj');
    const cfg = path.join(root, '.claude');
    fs.mkdirSync(path.join(cfg, 'notebook'), { recursive: true });
    fs.writeFileSync(path.join(cfg, '.geneseed-manifest.json'), '{"owned":[]}');
    const ledger = RUNS.map((r) => JSON.stringify(r)).join('\n');
    fs.writeFileSync(path.join(cfg, RUNS_LEDGER), `${ledger}\n`);
    const said = [];
    const write = process.stdout.write;
    process.stdout.write = (s) => { said.push(String(s)); return true; };
    let rc;
    try { rc = await inEnv({ GENESEED_NO_USAGE: undefined }, () => cmdAgentScores([['claude', 'project', root]])); }
    finally { process.stdout.write = write; }
    assert.equal(rc, 0);
    assert.deepEqual(said.join('').replace(/\r\n/g, '\n').split('\n'),
      [`[scores] claude project: ${path.join(cfg, RUNS_LEDGER)}`, ...TABLE.map((l) => `  ${l}`), '']);
    assert.equal(fs.readFileSync(path.join(cfg, RUNS_LEDGER), 'utf8'), `${ledger}\n`, 'the ledger is not rewritten');
  });
});
