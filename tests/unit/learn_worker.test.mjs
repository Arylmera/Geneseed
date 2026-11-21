// A2 of spec 2026-11-18-learn-model-row: the Claude-family wiring of the learn model.
//
// Every expectation is written out. No real model runs: `tests/fixtures/fake_llm.mjs` stands in for
// `$GENESEED_LLM`, and the one command whose first word must be `claude` is tested over `leanArgv`'s
// argv, never run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { wireClaudeEnv, unwireClaudeEnv } from '../../js/hosts/settings.mjs';
import { learnModelArg } from '../../js/build/emit-claude.mjs';
import { learnCommandFor } from '../../js/hosts/learn-command.mjs';
import { leanArgv } from '../../js/hosts/hooks-learn.mjs';
import { commandOnPath, learnCommandNotes } from '../../js/inspect/doctor.mjs';
import { learnInstalls } from '../../js/inspect/status.mjs';
import { learnLastNote, learnState, readLearnLast } from '../../js/hosts/memory-files.mjs';
import { FAKE_LLM } from '../helpers/cli_golden.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

const KEY = 'GENESEED_LLM';
const HAIKU = 'claude -p --model haiku';

function withDir(fn) {
  const sb = makeSandbox('learn-a2-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}
const readEnv = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).env;
function quietly(fn) {
  const w = process.stderr.write;
  let said = '';
  process.stderr.write = (t) => { said += t; return true; };
  try { return [fn(), said]; } finally { process.stderr.write = w; }
}

// D5: who owns GENESEED_LLM. Each row: the file's env before, what the manifest recorded, what the build
// wants, then the file's env after and the record after.
test('wireClaudeEnv replace-if-ours: absent is written, ours is replaced or removed, the user\'s is kept', () => {
  const rows = [
    ['absent: written and recorded', undefined, {}, { [KEY]: HAIKU }, { [KEY]: HAIKU }, { [KEY]: HAIKU }],
    ['ours, the choice changed: replaced, record follows', { [KEY]: HAIKU }, { [KEY]: HAIKU },
      { [KEY]: 'claude -p --model sonnet' }, { [KEY]: 'claude -p --model sonnet' }, { [KEY]: 'claude -p --model sonnet' }],
    ['ours, unchanged: stays, still recorded', { [KEY]: HAIKU }, { [KEY]: HAIKU }, { [KEY]: HAIKU },
      { [KEY]: HAIKU }, { [KEY]: HAIKU }],
    ['ours, now off (want names nothing): removed, env dropped when empty', { [KEY]: HAIKU }, { [KEY]: HAIKU }, {},
      undefined, {}],
    ['not recorded: the user\'s, kept, unrecorded', { [KEY]: 'ollama run x' }, {}, { [KEY]: HAIKU },
      { [KEY]: 'ollama run x' }, {}],
    ['recorded but edited since: the user\'s now, kept, record dropped', { [KEY]: 'ollama run x' }, { [KEY]: HAIKU },
      { [KEY]: 'claude -p --model sonnet' }, { [KEY]: 'ollama run x' }, {}],
    ['recorded but edited, then off: the user\'s value is not removed', { [KEY]: 'ollama run x' }, { [KEY]: HAIKU }, {},
      { [KEY]: 'ollama run x' }, {}],
    ['another key beside it is never touched', { OTHER: '1' }, {}, { [KEY]: HAIKU },
      { OTHER: '1', [KEY]: HAIKU }, { [KEY]: HAIKU }],
  ];
  for (const [what, before, recorded, want, after, record] of rows) {
    withDir((d) => {
      const p = path.join(d, 'settings.json');
      fs.writeFileSync(p, JSON.stringify(before === undefined ? { theme: 'x' } : { env: before }));
      const [got] = quietly(() => wireClaudeEnv(p, want, recorded));
      assert.deepEqual(got, record, `${what}: record`);
      assert.deepEqual(readEnv(p), after, `${what}: file`);
    });
  }
});

test('wireClaudeEnv: the user\'s value is said once on stderr; a commented file is not rewritten', () => {
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    fs.writeFileSync(p, JSON.stringify({ env: { [KEY]: 'ollama run x' } }));
    const [, said] = quietly(() => wireClaudeEnv(p, { [KEY]: HAIKU }, {}));
    assert.match(said, /env\.GENESEED_LLM.*set by you/);
    const c = path.join(d, 'c.json');
    const text = '{\n  // mine\n  "env": {}\n}\n';
    fs.writeFileSync(c, text);
    const [got, cs] = quietly(() => wireClaudeEnv(c, { [KEY]: HAIKU }, {}));
    assert.deepEqual(got, {});
    assert.equal(fs.readFileSync(c, 'utf8'), text);
    assert.match(cs, /has comments/);
  });
});

test('wireClaudeEnv without a record stays add-if-absent (the legacy shape)', () => {
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    fs.writeFileSync(p, JSON.stringify({ env: { A: 'mine' } }));
    assert.deepEqual(wireClaudeEnv(p, { A: 'theirs', B: '2' }), { B: '2' });
    assert.deepEqual(readEnv(p), { A: 'mine', B: '2' });
    unwireClaudeEnv(p, { B: '2' });
    assert.deepEqual(readEnv(p), { A: 'mine' });
  });
});

// D4, then O13: the command per host and choice. The emit bakes `--learn-model <m>` into the learn hook (learnModelArg)
// and the hook turns it into the command (learnCommandFor); each row states the command the two give together.
test('learnModelArg + learnCommandFor: the command the learn hook runs', () => {
  const rows = [
    ['claude light = haiku', ['light', 'claude'], 'claude -p --model haiku'],
    ['claude standard = sonnet', ['standard', 'claude'], 'claude -p --model sonnet'],
    ['claude session = no --model', ['session', 'claude'], 'claude -p'],
    ['claude off = nothing', ['off', 'claude'], null],
    ['claude light, the map names a model', ['light', 'claude', { light: 'claude-haiku-9' }], 'claude -p --model claude-haiku-9'],
    ['openclaude light, no map = session', ['light', 'openclaude'], 'openclaude -p'],
    ['openclaude light, the map names one', ['light', 'openclaude', { light: 'gpt-x' }], 'openclaude -p --model gpt-x'],
    ['openclaude off = nothing', ['off', 'openclaude'], null],
    ['bob = nothing', ['light', 'bob'], null],
    ['a model name holding a space cannot ride in the command', ['light', 'claude', { light: 'a b' }], 'claude -p'],
    // The command line runs in a shell: a shell character falls back to the session model too.
    ['a model holding a shell character falls back to session', ['light', 'claude', { light: 'x$(id)' }], 'claude -p'],
    // Bedrock and Vertex ids keep their `.` `:` `@`.
    ['a Bedrock id rides whole', ['light', 'claude', { light: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }], 'claude -p --model us.anthropic.claude-haiku-4-5-20251001-v1:0'],
    ['a Vertex id rides whole', ['light', 'claude', { light: 'claude-haiku-4-5@20251001' }], 'claude -p --model claude-haiku-4-5@20251001'],
  ];
  for (const [what, [learn, host, map], want] of rows) {
    assert.equal(learnCommandFor(host, learnModelArg(learn, host, map ?? {}, {})), want, what);
  }
});

// D13: the lean child.
test('leanArgv: lean flags for claude, probed ones for openclaude, nothing for any other command', () => {
  const got = leanArgv(['claude', '-p', '--model', 'haiku']);
  const role = got.at(-1);
  assert.match(role, /^You distil durable memories/);
  assert.deepEqual(got, ['claude', '-p', '--model', 'haiku', '--setting-sources', '', '--strict-mcp-config',
    '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', role]);
  // `--tools` is variadic: a flag, never the prompt, must follow its empty value.
  assert.ok(got[got.indexOf('--tools') + 2].startsWith('--'));
  assert.ok(!got.includes('--bare'), '--bare needs an API key: forbidden');
  // A path or a Windows extension is still claude; a flag the user's command has is not repeated.
  assert.ok(leanArgv(['C:\\bin\\Claude.EXE', '-p']).includes('--tools'));
  assert.equal(leanArgv(['claude', '-p', '--tools', 'Read']).filter((a) => a === '--tools').length, 1);
  // openclaude: only the flags its own help lists.
  const help = 'Options:\n  --tools <t>\n  --no-session-persistence\n  --system-prompt <p>\n';
  assert.deepEqual(leanArgv(['openclaude', '-p'], () => help),
    ['openclaude', '-p', '--tools', '', '--no-session-persistence', '--system-prompt',
      got.at(-1)]);
  assert.deepEqual(leanArgv(['openclaude', '-p'], () => ''), ['openclaude', '-p']);
  // R-F5: a flag is matched whole, never as the start of a longer one in the help text (`--tools` is not
  // `--tools-extra`; a plain substring test took it for listed).
  const longer = ['Options:', '  --tools-extra <t>', '  --append-system-prompt <p>', '  --system-prompt <p>', ''].join('\n');
  assert.deepEqual(leanArgv(['openclaude', '-p'], () => longer), ['openclaude', '-p', '--system-prompt', got.at(-1)],
    '--tools-extra is not --tools');
  // Any other command is used as given.
  assert.deepEqual(leanArgv(['ollama', 'run', 'x']), ['ollama', 'run', 'x']);
  assert.deepEqual(leanArgv(['node', FAKE_LLM]), ['node', FAKE_LLM]);
});

// The hook, as a process. A sandbox holds the install, the transcript and a fake model.
function rig(extra = {}) {
  const sb = makeSandbox();
  const inst = path.join(sb.path, 'inst');
  fs.mkdirSync(path.join(inst, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(inst, '.geneseed-manifest.json'), '{}');   // an install: its memory/ is a store a job may name
  const transcript = path.join(sb.path, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'why does the build fail on windows '.repeat(8) } })}\n`
    + `${JSON.stringify({ message: { role: 'assistant', content: 'cp1252 is the console code page' } })}\n`);
  const reply = path.join(sb.path, 'reply.md');
  fs.writeFileSync(reply, '---\nname: alpha-fact\ndescription: the first canned fact\nmetadata:\n  type: project\n---\n\nBody of the first fact.\n');
  const log = path.join(sb.path, 'calls.log');
  const env = {
    ...process.env, ...homeOverrides(path.join(sb.path, 'home')), GENESEED_LLM: `node ${FAKE_LLM}`,
    FAKE_LLM_OUT: reply, FAKE_LLM_LOG: log, ...extra,
  };
  delete env.GENESEED_LEARN_CHILD;
  const run = (payload, args = []) => spawnHook(['learn', '--memory', path.join(inst, 'memory'), '--no-done-gate', ...args],
    JSON.stringify(payload), { env });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const jobs = path.join(sb.path, 'home', '.config', 'geneseed', 'cache', 'learn-jobs');
  return { sb, inst, jobs, transcript, run, calls, env, fact: path.join(inst, 'memory', 'alpha-fact.md') };
}
async function until(cond, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return cond();
}

test('Stop and SubagentStop call no model; PreCompact and SessionEnd do (D8)', () => {
  const r = rig({ GENESEED_LEARN_INLINE: '1' });
  try {
    const base = { session_id: 's', transcript_path: r.transcript, cwd: r.sb.path };
    r.run({ ...base, hook_event_name: 'Stop' });
    r.run({ ...base, hook_event_name: 'SubagentStop', agent_name: 'explore', last_assistant_message: 'did the thing well' });
    assert.deepEqual(r.calls(), [], 'no model call on Stop or SubagentStop');
    assert.ok(!fs.existsSync(r.fact));
    r.run({ ...base, hook_event_name: 'PreCompact' });
    assert.ok(fs.existsSync(r.fact), 'PreCompact distils');
    // The one run also asked the queued sub-agent's lesson: two calls in all, one session.
    assert.equal(r.calls().length, 2);
    fs.rmSync(r.fact);
    // PreCompact mined the transcript: SessionEnd has something to distil only after the session went on (O8).
    fs.appendFileSync(r.transcript, `${JSON.stringify({ message: { role: 'user', content: 'and now the same failure on macos '.repeat(8) } })}
`);
    r.run({ ...base, hook_event_name: 'SessionEnd' });
    assert.ok(fs.existsSync(r.fact), 'SessionEnd distils');
    assert.equal(r.calls().length, 3, 'the queue was taken: one call this time');
  } finally { r.sb.cleanup(); }
});

test('SessionEnd starts a detached worker: the hook returns first, the job runs, the job file goes (D12)', async () => {
  const r = rig({ FAKE_LLM_DELAY_MS: '3000' });
  try {
    const res = r.run({ session_id: 's', transcript_path: r.transcript, hook_event_name: 'SessionEnd' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    const { jobs } = r;
    // The job lives in the machine cache, never in the install (a project install is the user's repo).
    assert.ok(!fs.existsSync(path.join(r.inst, 'learn-jobs')));
    assert.equal(fs.readdirSync(jobs).filter((n) => /^job-.*\.json$/.test(n)).length, 1, 'the job is written');
    assert.ok(!fs.existsSync(r.fact), 'the hook did not wait for the model');
    assert.ok(await until(() => fs.existsSync(r.fact)), 'the worker wrote the memory');
    assert.ok(await until(() => fs.readdirSync(jobs).filter((n) => n.startsWith('job-')).length === 0), 'the worker deleted its job (the session cursor stays beside it)');
  } finally { r.sb.cleanup(); }
});

test('learn-worker: the job round trip, and a file that is no job of ours is ignored', () => {
  const r = rig();
  try {
    const { jobs } = r;
    fs.mkdirSync(jobs, { recursive: true });
    const job = { v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(r.inst, 'memory'),
      transcript: r.transcript, agents: [] };
    const good = path.join(jobs, 'job-1.json');
    fs.writeFileSync(good, JSON.stringify(job));
    assert.equal(spawnHook(['learn-worker', good], '', { env: r.env }).status, 0);
    assert.ok(fs.existsSync(r.fact));
    assert.ok(!fs.existsSync(good), 'the job is deleted');
    fs.rmSync(r.fact);
    const stray = path.join(r.sb.path, 'job-2.json');
    fs.writeFileSync(stray, JSON.stringify(job));
    const misnamed = path.join(jobs, 'other.json');
    fs.writeFileSync(misnamed, JSON.stringify(job));
    for (const f of [stray, misnamed]) {
      assert.equal(spawnHook(['learn-worker', f], '', { env: r.env }).status, 0);
      assert.ok(fs.existsSync(f), `${f} is not a job: untouched`);
    }
    assert.ok(!fs.existsSync(r.fact), 'nothing ran for them');
  } finally { r.sb.cleanup(); }
});

// D9/D10: the report reads what the manifest recorded.
test('learnInstalls reads the recorded command and the install\'s learn choice; learnState words them', () => {
  withDir((d) => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = d;
    try {
      fs.writeFileSync(path.join(d, '.geneseed-manifest.json'),
        JSON.stringify({ managed: { settings_env: { [KEY]: HAIKU } } }));
      fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ env: { [KEY]: HAIKU } }));
      const [one] = learnInstalls([['claude', 'global', d]]);
      assert.equal(one.recorded, HAIKU);
      assert.equal(learnState({}, [one]), 'claude: active (haiku)');
      fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ env: { [KEY]: 'llm -m x' } }));
      assert.equal(learnState({}, learnInstalls([['claude', 'global', d]])), 'claude: active (set by you)');
      fs.writeFileSync(path.join(d, 'settings.json'), '{}');
      assert.equal(learnState({}, learnInstalls([['claude', 'global', d]])), 'claude: dormant ($GENESEED_LLM unset)');
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });
});

test('doctor: a command whose first word is not on PATH is a note, never a problem', () => {
  const has = new Set([path.join('/bin', 'claude')]);
  const exists = (p) => has.has(p);
  assert.equal(commandOnPath('claude', { PATH: '/bin:/usr/bin' }, exists, 'linux'), true);
  assert.equal(commandOnPath('openclaude', { PATH: '/bin:/usr/bin' }, exists, 'linux'), false);
  assert.equal(commandOnPath('claude', { PATH: 'C:\\x', PATHEXT: '.EXE' }, (p) => p === path.join('C:\\x', 'claude.exe'), 'win32'), true);
  const onPath = (w) => w === 'claude';
  const inst = (host, llm) => ({ host, settingsEnv: [{ [KEY]: llm }] });
  assert.deepEqual(learnCommandNotes([inst('claude', HAIKU)], {}, onPath), []);
  const notes = learnCommandNotes([inst('openclaude', 'openclaude -p'), { host: 'bob' }, { host: 'opencode' }], {}, onPath);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^\[note\] learn: openclaude's model command 'openclaude' is not on PATH/);
});

// S1f: a model that failed (a lapsed login) said nothing, whatever it printed on stdout.
test('a failed model call is no reply: nothing is stored from its stdout', () => {
  const r = rig({ FAKE_LLM_RC: '1' });
  try {
    fs.mkdirSync(r.jobs, { recursive: true });
    const job = { v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(r.inst, 'memory'),
      transcript: r.transcript,
      agents: [{ agent: 'explore', payload: { last_assistant_message: 'did the thing well enough' } }] };
    const file = path.join(r.jobs, 'job-9.json');
    fs.writeFileSync(file, JSON.stringify(job));
    spawnHook(['learn-worker', file], '', { env: r.env });
    assert.equal(r.calls().length, 2, 'both calls were made');
    assert.ok(!fs.existsSync(r.fact), 'no memory from a failed call');
    assert.ok(!fs.existsSync(path.join(r.inst, 'memory', 'agents', 'explore.md')), 'no lesson from a failed call');
  } finally { r.sb.cleanup(); }
});

test('learnState: the most specific settings file names the command (local over project over user)', () => {
  const user = { GENESEED_LLM: 'claude -p --model haiku' };
  const local = { GENESEED_LLM: 'claude -p --model sonnet' };
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [user, null, local], recorded: local.GENESEED_LLM }]),
    'claude: active (sonnet)');
  assert.equal(learnCommandNotes([{ host: 'claude', settingsEnv: [{ GENESEED_LLM: 'claude -p' }, null, { GENESEED_LLM: 'zzz -p' }] }],
    {}, (w) => w === 'claude').length, 1);
});

// S-F7: a build with nothing to write and nothing of ours to remove (OpenClaude, `--learn off`, no key) reads no
// settings file, so a commented one draws no new warning.
test('wireClaudeEnv with nothing wanted and nothing recorded does not read the file, so it cannot warn about it', () => {
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    // Not valid JSON: reading it for nothing would print "NOT touching it" at every build.
    fs.writeFileSync(p, '{ not json');
    const [got, said] = quietly(() => wireClaudeEnv(p, {}, {}));
    assert.deepEqual(got, {});
    assert.equal(said, '');
    // A key of ours on record still reads the file: it has something to remove.
    fs.writeFileSync(p, `{
  // mine
  "env": { "${KEY}": "${HAIKU}" }
}
`);
    const [, said2] = quietly(() => wireClaudeEnv(p, {}, { [KEY]: HAIKU }));
    assert.match(said2, /has comments/);
  });
});

// ---- F1: a failed worker run is not hidden behind "active" -------------------------------------------------------

const lastFile = (r) => path.join(r.sb.path, 'home', '.config', 'geneseed', 'cache', 'learn-last.json');
function workerRun(r, env) {
  fs.mkdirSync(r.jobs, { recursive: true });
  const file = path.join(r.jobs, `job-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(r.inst, 'memory'),
    transcript: r.transcript, agents: [] }));
  return spawnHook(['learn-worker', file], '', { env: { ...r.env, ...env } });
}
const installs = [{ host: 'claude', settingsEnv: [{ GENESEED_LLM: HAIKU }], recorded: HAIKU }];

test('a worker run whose model fails leaves a verdict that learnState words; a later success clears it', () => {
  const r = rig();
  try {
    workerRun(r, { FAKE_LLM_RC: '1', FAKE_LLM_ERR: 'Invalid API key' });
    const failed = readLearnLast(lastFile(r));
    assert.equal(failed.ok, false, 'a model that exited 1 is a failed run');
    assert.match(failed.reason, /exited 1: Invalid API key/, 'the reason is one line naming the exit and what the model said');
    assert.match(learnState({}, installs, failed), /^claude: active \(haiku\) · last run failed \d{4}-\d{2}-\d{2}: .*exited 1/);
    workerRun(r, {});
    const fine = readLearnLast(lastFile(r));
    assert.equal(fine.ok, true, 'the next run, with a model that answers, replaces the verdict');
    assert.equal(fine.facts, 1, 'and counts the fact it stored');
    assert.equal(learnState({}, installs, fine), 'claude: active (haiku)', 'a success adds nothing to the line');
    assert.equal(learnState({}, installs, null), 'claude: active (haiku)', 'no verdict adds nothing either');
  } finally { r.sb.cleanup(); }
});

test('a model that exits 0 and says nothing is a failed run (a lapsed login), not NOTHING', () => {
  const r = rig({ FAKE_LLM_OUT: '' });
  try {
    delete r.env.FAKE_LLM_OUT;
    workerRun(r, {});
    assert.match(readLearnLast(lastFile(r)).reason, /empty reply/);
  } finally { r.sb.cleanup(); }
});

test('learnState says a failed verdict only where something is active', () => {
  const bad = { at: '2026-11-18T10:00:00Z', ok: false, reason: 'timeout' };
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [], learn: 'off' }], bad), 'claude: off');
  assert.equal(learnState({ GENESEED_LLM: 'x' }, [], bad), 'active · last run failed 2026-11-18: timeout');
});

// ---- F4: a hook event never runs the model inline ----------------------------------------------------------------

test('a hook event with no install found skips the distil: no model call, the skip is the verdict', () => {
  const r = rig();
  try {
    // No `--memory`: the hook can name no install.
    const res = spawnHook(['learn', '--no-done-gate'],
      JSON.stringify({ session_id: 's', transcript_path: r.transcript, hook_event_name: 'SessionEnd' }), { env: r.env });
    assert.equal(res.status, 0);
    assert.deepEqual(r.calls(), [], 'the model was not called in the hook process');
    assert.match(res.stderr, /no Geneseed install/);
    const last = readLearnLast(lastFile(r));
    assert.equal(last.ok, false);
    assert.match(last.reason, /skipped/);
  } finally { r.sb.cleanup(); }
});

// ---- F6: only GENESEED_LLM's refusal is news ---------------------------------------------------------------------

test('wireClaudeEnv: a user-set spawn depth is kept silently; a user-set GENESEED_LLM is still said', () => {
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    fs.writeFileSync(p, JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' } }));
    const [, said] = quietly(() => wireClaudeEnv(p, { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' }, {}));
    assert.equal(said, '', 'the user\'s depth is theirs: nothing printed on a rebuild');
    assert.equal(readEnv(p).CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '5');
  });
});

// ---- the blind review's round: stuck runs, prose replies, hostile verdict files -----------------------------------

test('a run is marked running before the model is called, and a mark past its deadline reads as stuck', async () => {
  const r = rig({ FAKE_LLM_DELAY_MS: '2500' });
  try {
    r.run({ session_id: 's', transcript_path: r.transcript, hook_event_name: 'SessionEnd' });
    assert.ok(await until(() => readLearnLast(lastFile(r))?.running === true), 'the worker marks the run before it answers');
    const mark = readLearnLast(lastFile(r));
    assert.equal(learnState({}, installs, mark), 'claude: active (haiku)', 'a fresh run adds nothing');
    const late = Date.parse(mark.by) + 1000;
    assert.match(learnState({}, installs, mark).concat(learnLastNote(mark, late)), /last run stuck since \d{4}-\d{2}-\d{2}$/,
      'past `by` the same mark is a stuck run');
    assert.ok(await until(() => readLearnLast(lastFile(r))?.ok === true), 'a run that ends replaces the mark');
  } finally { r.sb.cleanup(); }
});

test('a model that exits 0 with prose and no memory file is a failed run', () => {
  const r = rig();
  try {
    fs.writeFileSync(path.join(r.sb.path, 'prose.txt'), 'Please run /login to continue\n');
    workerRun(r, { FAKE_LLM_OUT: path.join(r.sb.path, 'prose.txt') });
    const last = readLearnLast(lastFile(r));
    assert.equal(last.ok, false);
    assert.match(last.reason, /^unparseable reply: Please run \/login to continue$/);
    assert.ok(!fs.existsSync(r.fact));
    // A reply that is a stored fact again (a duplicate) is not prose: it stays a success.
    workerRun(r, {});
    workerRun(r, {});
    assert.equal(readLearnLast(lastFile(r)).ok, true, 'a duplicate fact is not a failure');
  } finally { r.sb.cleanup(); }
});

test('an empty reply to a sub-agent lesson is a failed run, as it is for the transcript', () => {
  const r = rig();
  try {
    delete r.env.FAKE_LLM_OUT;
    fs.mkdirSync(r.jobs, { recursive: true });
    const file = path.join(r.jobs, 'job-11.json');
    fs.writeFileSync(file, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(r.inst, 'memory'),
      transcript: null, agents: [{ agent: 'explore', payload: { last_assistant_message: 'did the thing well enough' } }] }));
    spawnHook(['learn-worker', file], '', { env: r.env });
    assert.equal(r.calls().length, 1, 'only the lesson was asked');
    assert.match(readLearnLast(lastFile(r)).reason, /empty reply/);
  } finally { r.sb.cleanup(); }
});

test('an unreadable job replaces an earlier good verdict with a failure', () => {
  const r = rig();
  try {
    workerRun(r, {});
    assert.equal(readLearnLast(lastFile(r)).ok, true);
    const bad = path.join(r.jobs, 'job-12.json');
    fs.writeFileSync(bad, '{ not json');
    spawnHook(['learn-worker', bad], '', { env: r.env });
    const last = readLearnLast(lastFile(r));
    assert.equal(last.ok, false);
    assert.match(last.reason, /the job could not be read/);
  } finally { r.sb.cleanup(); }
});

test('a verdict file is data: control characters go, the reason is cut, a bad date is not printed', () => {
  // C0, DEL, C1 (`\u009b` is CSI on an 8-bit terminal) and the bidi overrides that reorder printed text.
  const evil = { at: '\u001b[2Jnot a date', ok: false,
    reason: `\u001b[31mred\u001b]0;pwned\u0007 \u009b2J \u202egnp.exe\u202c ${'x'.repeat(500)}` };
  const note = learnLastNote(evil);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(note), 'no control character reaches the terminal');
  assert.match(note, /^ · last run failed an unknown date: /);
  assert.ok(note.length < 260, 'the reason is capped at 200 characters');
  const r = rig();
  try {
    fs.mkdirSync(path.dirname(lastFile(r)), { recursive: true });
    fs.writeFileSync(lastFile(r), JSON.stringify(evil));
    assert.ok(!/[\u0000-\u001f\u007f]/.test(learnState({}, installs, readLearnLast(lastFile(r)))));
  } finally { r.sb.cleanup(); }
});

// A hung npm CLI: cmd.exe is killed at the timeout but the node it started is not, and it holds the stdout pipe.
// With pipes `spawnSync` returned only when that node did (15.7 s for a 2 s timeout); with files it returns at the kill.
test('a .cmd shim that hangs is abandoned at the timeout, not when its child exits (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const r = rig();
  try {
    const bin = path.join(r.sb.path, 'shims');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'hang-llm.cmd'), `@"${process.execPath}" -e "setTimeout(()=>{},15000)"\r\n`);
    const t0 = Date.now();
    workerRun(r, { PATH: `${bin};${process.env.PATH}`, GENESEED_LLM: 'hang-llm', GENESEED_LLM_TIMEOUT: '2' });
    const took = Date.now() - t0;
    assert.ok(took < 10000, `the worker returned after ${took} ms, not after the hung child's 15 s`);
    assert.match(readLearnLast(lastFile(r)).reason, /gave no answer in 2 s/);
  } finally { r.sb.cleanup(); }
});

// The model's prompt is transcript text, written to a scratch folder so no pipe can hold the wait. That folder
// must be gone after the run, an answered one and a timed-out one alike. (A throw before the call is covered by
// the same `finally` but cannot be provoked from here: no env value can carry the NUL that would make spawn throw.)
test('the scratch folder holding the prompt is removed after an answered run and after a timeout', () => {
  const r = rig();
  try {
    const tmp = path.join(r.sb.path, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tmpEnv = { TEMP: tmp, TMP: tmp, TMPDIR: tmp };
    workerRun(r, tmpEnv);
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('geneseed-learn-')), [], 'answered run leaves no scratch');
    workerRun(r, { ...tmpEnv, GENESEED_LLM: `node -e "setTimeout(()=>{},15000)"`, GENESEED_LLM_TIMEOUT: '1' });
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('geneseed-learn-')), [], 'timed-out run leaves no scratch');
  } finally { r.sb.cleanup(); }
});

// O13: with no `$GENESEED_LLM`, the hook runs the command its `--learn-model` gives, on its own host's CLI. A fake
// `claude` on PATH stands in for the real one and logs its argv: the model rides as `--model haiku`, and `session`
// adds no `--model`. With neither, the hook says there is no learn model and calls nothing.
test('the learn hook derives its command from --learn-model when $GENESEED_LLM is unset', () => {
  const r = rig({ GENESEED_LEARN_INLINE: '1' });
  try {
    delete r.env.GENESEED_LLM;
    const bin = path.join(r.sb.path, 'shims');
    fs.mkdirSync(bin, { recursive: true });
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${FAKE_LLM}" %*\r\n`);
    } else {
      fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_LLM}" "$@"\n`, { mode: 0o755 });
    }
    r.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
    r.env.FAKE_LLM_STDIN = '1';
    const ev = (session) => ({ session_id: session, transcript_path: r.transcript, cwd: r.sb.path, hook_event_name: 'SessionEnd' });
    const none = r.run(ev('s0'));
    assert.match(none.stderr, /no learn model/);
    assert.deepEqual(r.calls(), [], 'no command, no call');
    r.run(ev('s1'), ['--learn-model', 'haiku']);
    const [first] = r.calls().map((l) => JSON.parse(l));
    assert.ok(first, 'the derived command ran');
    assert.ok(first.includes('-p') && first[first.indexOf('--model') + 1] === 'haiku', JSON.stringify(first));
    assert.ok(fs.existsSync(r.fact), 'its reply was stored');
    r.run(ev('s2'), ['--learn-model', 'session']);
    const second = JSON.parse(r.calls()[1]);
    assert.ok(second.includes('-p') && !second.includes('--model'), JSON.stringify(second));
  } finally { r.sb.cleanup(); }
});

// O13: `baked` is what the hook runs; an older build's `settings_env` record only says whose a value is. An install whose
// manifest holds `learn_command` learns with an empty settings env; one with only the old record and no env is dormant.
test('learnState runs the baked command; an old settings_env record alone is no command', () => {
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [{}], recorded: HAIKU, baked: HAIKU }]), 'claude: active (haiku)');
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [{}], recorded: HAIKU, baked: null }]), 'claude: dormant ($GENESEED_LLM unset)');
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [{ GENESEED_LLM: 'llm -m x' }], recorded: HAIKU, baked: HAIKU }]),
    'claude: active (set by you)');
});
