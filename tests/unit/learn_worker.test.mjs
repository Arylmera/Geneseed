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
import { learnEnvCommand } from '../../js/build/emit-claude.mjs';
import { leanArgv } from '../../js/hosts/hooks-learn.mjs';
import { commandOnPath, learnCommandNotes } from '../../js/inspect/doctor.mjs';
import { learnInstalls } from '../../js/inspect/status.mjs';
import { learnState } from '../../js/hosts/memory-files.mjs';
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

// D4: the command, per host and choice.
test('learnEnvCommand: the command the emit writes', () => {
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
  ];
  for (const [what, [learn, host, map], want] of rows) {
    assert.equal(learnEnvCommand(learn, host, map ?? {}, {}), want, what);
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
  fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'why does the build fail on windows' } })}\n`
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
    assert.ok(await until(() => fs.readdirSync(jobs).length === 0), 'the worker deleted its job');
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
