// The hook-side activity writer (js/hosts/activity.mjs), its off switch in the hook entry, and
// what the web reader (js/web/activity.mjs) makes of the files it leaves.
//
// THE PAYLOAD TABLES are the contract with the hosts, and each expectation is written out:
// - Claude Code and OpenClaude send `{hook_event_name, session_id, tool_name, tool_input}`;
//   SessionStart idles, UserPromptSubmit starts a turn, PreToolUse names the phase, Stop waits on
//   the user and reads the transcript the turn appended, SessionEnd ends;
// - Bob sends `{event, session_id, tool, input}` and never a transcript, so a Bob session is
//   only what its matcher-less tool-gate sees, one call at a time;
// - a shell command, a file's content and an edit's text are never written anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  applyHookEvent, readTranscriptDelta, recordActivity, safeStem, sweepActivity,
  ARCHIVE_KEEP,
} from '../../js/hosts/activity.mjs';
import { apiActivity, apiActivityDetail } from '../../js/web/activity.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { ROOT } from '../helpers/web_fixture.mjs';

const HOOK = path.join(ROOT, 'bin', 'geneseed-hook.mjs');
const NOW = 1_800_000_000;            // seconds, as `updated_at` is
const withBox = (fn) => { const sb = makeSandbox('activity-'); try { return fn(sb.path); } finally { sb.cleanup(); } };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

test('a Claude session, event by event', () => {
  let s = applyHookEvent(null, null,
    { hook_event_name: 'SessionStart', session_id: 'c1', cwd: '/repo', source: 'startup' }, NOW);
  assert.deepEqual(s.snap, {
    session_id: 'c1', agent: null, title: null, cwd: '/repo', status: 'idle', pid: null,
    writer: 'hook', host: 'claude', updated_at: NOW, model: null, tokens: 0, files: null, todos: null,
  });
  assert.deepEqual(s.detail.timeline,
    [{ t: NOW * 1000, kind: 'step', label: 'Session startup', status: 'completed' }]);

  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'UserPromptSubmit', session_id: 'c1',
    prompt: 'fix   the\nlogin bug' }, NOW + 1);
  assert.equal(s.snap.status, 'busy');
  assert.equal(s.snap.title, 'fix the login bug');           // whitespace runs collapse
  assert.equal(s.snap.turn_started_at, NOW + 1);
  assert.deepEqual(s.detail.conversation,
    [{ role: 'user', text: 'fix the login bug', t: (NOW + 1) * 1000 }]);

  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'PreToolUse', session_id: 'c1',
    tool_name: 'Edit', tool_use_id: 'tu1',
    tool_input: { file_path: '/repo/src/login.js', old_string: 'a\nb', new_string: 'x\ny\nz' } }, NOW + 2);
  assert.equal(s.snap.phase, 'Edit login.js');
  assert.deepEqual(s.snap.files, { count: 1, additions: 3, deletions: 2,
    items: [{ file: 'login.js', additions: 3, deletions: 2 }] });
  assert.deepEqual(s.detail.timeline.at(-1), { t: (NOW + 2) * 1000, kind: 'tool',
    label: 'Edit login.js', tool: 'Edit', status: 'running', id: 'tu1' });

  // The Stop delta: the same Edit (by its tool_use id — counted once), a Read the gates never saw,
  // a TodoWrite, two lines of ONE message (usage counted once), and the final reply.
  const delta = { offset: 999, entries: [
    { type: 'user', message: { content: 'ignored' } },
    { type: 'assistant', timestamp: '2027-01-15T08:00:03.000Z', message: { id: 'm1', model: 'claude-opus-x',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tu1', name: 'Edit',
        input: { file_path: '/repo/src/login.js', old_string: 'a\nb', new_string: 'x\ny\nz' } }] } },
    { type: 'assistant', timestamp: '2027-01-15T08:00:04.000Z', message: { id: 'm1', model: 'claude-opus-x',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: 'C:\\repo\\README.md' } }] } },
    { type: 'assistant', timestamp: '2027-01-15T08:00:05.000Z', message: { id: 'm2', model: 'claude-opus-x',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: 'tool_use', id: 'tu3', name: 'TodoWrite', input: { todos: [
        { content: 'reproduce', status: 'completed' }, { content: 'fix', status: 'in_progress' }] } },
      { type: 'text', text: 'Fixed the login bug.' }] } },
  ] };
  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'Stop', session_id: 'c1' }, NOW + 9, { delta });
  assert.equal(s.snap.status, 'waiting-input');
  assert.equal(s.snap.phase, null);
  assert.equal(s.snap.turn_started_at, null);
  assert.equal(s.snap.model, 'claude-opus-x');
  assert.equal(s.snap.tokens, 18);                            // m1 once (15) + m2 (3)
  assert.equal(s.snap.transcript_offset, 999);
  assert.equal(s.snap.files.count, 1, 'the Edit the gate saw is not counted twice; a Read is no edit');
  assert.deepEqual(s.snap.todos, { done: 1, total: 2, items: [
    { content: 'reproduce', status: 'completed' }, { content: 'fix', status: 'in_progress' }] });
  assert.deepEqual(s.detail.timeline.slice(1).map((r) => [r.label, r.status]), [
    ['Edit login.js', 'completed'], ['Read README.md', 'completed'], ['TodoWrite', 'completed']]);
  assert.deepEqual(s.detail.conversation.at(-1),
    { role: 'assistant', text: 'Fixed the login bug.', t: (NOW + 9) * 1000 });

  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'SessionEnd', session_id: 'c1' }, NOW + 10);
  assert.equal(s.snap.status, 'ended');
});

test('a Bob session reads its own payload shape', () => {
  let s = applyHookEvent(null, null, { event: 'PreToolUse', session_id: 'b1', tool: 'write_to_file',
    input: { path: 'docs/a.md', content: 'one\ntwo' } }, NOW, { host: 'bob' });
  assert.equal(s.snap.host, 'bob');
  assert.equal(s.snap.status, 'busy');
  assert.equal(s.snap.phase, 'write_to_file a.md');
  assert.deepEqual(s.snap.files.items, [{ file: 'a.md', additions: 2, deletions: 0 }]);
  // No event name at all but a tool: a PreToolUse.
  s = applyHookEvent(s.snap, s.detail, { session_id: 'b1', tool: 'read_file', input: { path: 'x.md' } }, NOW + 1);
  assert.equal(s.snap.phase, 'read_file x.md');
  assert.equal(s.snap.files.count, 1);
  s = applyHookEvent(s.snap, s.detail, { event: 'Stop', session_id: 'b1' }, NOW + 2);
  assert.equal(s.snap.status, 'waiting-input');
  assert.deepEqual(s.detail.timeline.map((r) => r.status), ['completed', 'completed']);
  // An event this writer does not know writes nothing.
  assert.equal(applyHookEvent(null, null, { event: 'Notification', session_id: 'b1' }, NOW), null);
});

test('a command, a file body and an edit text are never recorded', () => {
  const SECRET = 'hunter2-SECRET';
  let s = applyHookEvent(null, null, { hook_event_name: 'PreToolUse', session_id: 'p',
    tool_name: 'Bash', tool_input: { command: `curl -H "token: ${SECRET}" x` } }, NOW);
  assert.equal(s.snap.phase, 'Bash');
  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'PreToolUse', session_id: 'p',
    tool_name: 'Write', tool_input: { file_path: '/r/.env', content: `KEY=${SECRET}` } }, NOW);
  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'PreToolUse', session_id: 'p',
    tool_name: 'Edit', tool_input: { file_path: '/r/a.js', old_string: SECRET, new_string: SECRET } }, NOW);
  assert.ok(!JSON.stringify(s).includes(SECRET), 'a secret reached the activity files');
  assert.ok(!JSON.stringify(s).includes('/r/'), 'a full path reached the activity files');
});

test('a transcript delta consumes complete lines only, and caps to the newest bytes', () => withBox((d) => {
  const f = path.join(d, 't.jsonl');
  const a = JSON.stringify({ type: 'assistant', n: 1 });
  const b = JSON.stringify({ type: 'assistant', n: 2 });
  fs.writeFileSync(f, `${a}\n${b.slice(0, 5)}`);            // the host is mid-way through line 2
  let r = readTranscriptDelta(f, 0);
  assert.deepEqual(r.entries.map((e) => e.n), [1]);
  assert.equal(r.offset, a.length + 1);
  fs.writeFileSync(f, `${a}\n${b}\n`);
  r = readTranscriptDelta(f, r.offset);
  assert.deepEqual(r.entries.map((e) => e.n), [2]);
  assert.equal(r.offset, a.length + b.length + 2);
  // An offset past the end: the file was replaced, so it is read from the start.
  assert.deepEqual(readTranscriptDelta(f, 10_000).entries.map((e) => e.n), [1, 2]);
  // A cap shorter than the delta keeps the newest line and drops the one the cut lands in.
  assert.deepEqual(readTranscriptDelta(f, 0, b.length + 3).entries.map((e) => e.n), [2]);
  assert.deepEqual(readTranscriptDelta(path.join(d, 'none.jsonl'), 7), { entries: [], offset: 7 });
}));

test('recordActivity reads the transcript from the stored offset on each Stop', () => withBox((root) => {
  const tr = path.join(root, 't.jsonl');
  const turn = (id, n) => ({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: n, output_tokens: 0 }, content: [] } });
  fs.writeFileSync(tr, jsonl([turn('m1', 5)]));
  const stop = JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: tr });
  assert.equal(recordActivity(root, stop, { now: NOW }), true);
  fs.appendFileSync(tr, jsonl([turn('m2', 7)]));
  recordActivity(root, stop, { now: NOW + 1 });
  const snap = readJson(path.join(root, 'activity', 's.json'));
  assert.equal(snap.tokens, 12, 'm1 was read twice, or m2 not at all');
  assert.equal(snap.transcript_offset, fs.statSync(tr).size);
}));

test('a hostile session id stays inside the activity directory', () => withBox((root) => {
  assert.equal(safeStem('../../x:y\\z'), '.._.._x_y_z');
  assert.equal(safeStem('a'.repeat(300)).length, 128);
  recordActivity(root, JSON.stringify({ hook_event_name: 'SessionStart', session_id: '../../escaped' }), { now: NOW });
  assert.deepEqual(fs.readdirSync(root).sort(), ['activity']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'activity')).sort(),
    ['.._.._escaped.detail.json', '.._.._escaped.json', '.gitignore']);
  assert.equal(recordActivity(root, JSON.stringify({ hook_event_name: 'SessionStart' }), { now: NOW }), false);
  assert.equal(recordActivity(root, 'not json', { now: NOW }), false);
}));

// A project install writes `<repo>/.claude/activity/`, inside the repo: its own `.gitignore`
// keeps it out of every commit, and a user's edit to that file is never overwritten.
test('the activity directory ignores itself, create-if-absent', () => withBox((root) => {
  const start = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's' });
  recordActivity(root, start, { now: NOW });
  const gi = path.join(root, 'activity', '.gitignore');
  assert.equal(fs.readFileSync(gi, 'utf8'), '*\n');
  fs.writeFileSync(gi, '# mine\n*\n');
  recordActivity(root, start, { now: NOW + 1 });
  assert.equal(fs.readFileSync(gi, 'utf8'), '# mine\n*\n');
}));

// Every snippet passes Law I's pattern (the one rule-gate uses) before it reaches disk.
test('a credential in a prompt, a todo or a reply is written as [redacted]', () => {
  const KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  let s = applyHookEvent(null, null, { hook_event_name: 'UserPromptSubmit', session_id: 'r',
    prompt: `use ${KEY} for the bucket` }, NOW);
  assert.equal(s.snap.title, 'use [redacted] for the bucket');
  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'PreToolUse', session_id: 'r',
    tool_name: 'TodoWrite', tool_input: { todos: [{ content: `rotate ${KEY}`, status: 'pending' }] } }, NOW);
  s = applyHookEvent(s.snap, s.detail, { hook_event_name: 'Stop', session_id: 'r',
    last_assistant_message: `Stored ${KEY}.` }, NOW);
  assert.deepEqual(s.snap.todos.items, [{ content: 'rotate [redacted]', status: 'pending' }]);
  assert.equal(s.detail.conversation.at(-1).text, 'Stored [redacted].');
  assert.ok(!JSON.stringify(s).includes(KEY), 'a credential reached the activity files');
});

// A transcript path that is not a regular file (a FIFO on POSIX, a named pipe on Windows) must
// not be opened: the open, or the read, blocks until a writer comes, and the hook hangs. Run in a
// child with a timeout, so a regression is a red test rather than a hung suite.
test('a transcript path that is a pipe is never opened', async () => {
  const sb = makeSandbox('activity-');
  let server = null;
  try {
    let pipe;
    if (process.platform === 'win32') {
      pipe = `\\\\.\\pipe\\geneseed-activity-${process.pid}-${Date.now()}`;
      const net = await import('node:net');
      server = net.createServer(() => {});
      await new Promise((ok) => server.listen(pipe, ok));
    } else {
      pipe = path.join(sb.path, 'fifo');
      assert.equal(spawnSync('mkfifo', [pipe]).status, 0, 'mkfifo failed');
    }
    const mod = pathToFileURL(path.join(ROOT, 'js', 'hosts', 'activity.mjs')).href;
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `const { readTranscriptDelta } = await import(${JSON.stringify(mod)});
       console.log(JSON.stringify(readTranscriptDelta(${JSON.stringify(pipe)}, 3)));`],
    { windowsHide: true });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    const code = await new Promise((ok) => {
      const t = setTimeout(() => { child.kill(); ok('timeout'); }, 8000);
      child.on('exit', (c) => { clearTimeout(t); ok(c); });
    });
    assert.equal(code, 0, `the read did not return (${code}) — a pipe was opened`);
    // POSIX: `stat` names the FIFO and nothing is opened, so the offset comes back unchanged.
    // Windows: `stat` calls a named pipe a regular file of size 0, so it is opened, read for 0
    // bytes and the offset resets — measured 2026-10-25; it returns either way, which is the point.
    assert.deepEqual(JSON.parse(out), { entries: [], offset: process.platform === 'win32' ? 0 : 3 });
  } finally {
    if (server) server.close();
    sb.cleanup();
  }
});

test('an excluded repo is never recorded', () => withBox((root) => {
  fs.writeFileSync(path.join(root, 'excludes.json'), JSON.stringify({ excludes: [process.cwd()] }));
  assert.equal(recordActivity(root, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's' }), { now: NOW }), false);
  assert.ok(!fs.existsSync(path.join(root, 'activity')));
}));

// The sweep's three directions: what is not live moves (with its detail), what is live stays,
// and the archive keeps the newest ARCHIVE_KEEP and nothing older than a week.
test('the sweep archives what is not live and caps the archive', () => withBox((d) => {
  const arch = path.join(d, 'archive');
  fs.mkdirSync(arch, { recursive: true });
  const put = (dir, stem, entry) => fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(entry));
  put(d, 'live', { session_id: 'live', status: 'busy', pid: null, updated_at: NOW });
  put(d, 'gone', { session_id: 'gone', status: 'ended', pid: null, updated_at: NOW });
  fs.writeFileSync(path.join(d, 'gone.detail.json'), '{"timeline":[]}');
  put(d, 'stale', { session_id: 'stale', status: 'busy', pid: null, updated_at: NOW - 1801 });
  fs.writeFileSync(path.join(d, 'garbage.json'), '{ not json');
  // 50 archived an hour or more ago, oldest first; with the two moved in that is 52 — plus one
  // eight days old that goes on age alone.
  for (let i = 0; i < 50; i += 1) put(arch, `old${i}`, { session_id: `old${i}`, status: 'ended', updated_at: NOW - 3600 - (50 - i) });
  fs.writeFileSync(path.join(arch, 'old0.detail.json'), '{}');
  put(arch, 'ancient', { session_id: 'ancient', status: 'ended', updated_at: NOW - 8 * 86400 });
  sweepActivity(d, NOW);
  assert.deepEqual(fs.readdirSync(d).filter((n) => n !== 'archive').sort(), ['garbage.json', 'live.json']);
  const kept = fs.readdirSync(arch);
  assert.ok(kept.includes('gone.json') && kept.includes('gone.detail.json'), 'the detail did not move with its snapshot');
  assert.ok(kept.includes('stale.json'));
  assert.equal(kept.filter((n) => !n.endsWith('.detail.json')).length, ARCHIVE_KEEP);
  assert.ok(!kept.includes('old0.json') && !kept.includes('old0.detail.json'), 'the oldest survived the cap');
  assert.ok(!kept.includes('old1.json'), 'the second oldest survived the cap');
  assert.ok(kept.includes('old2.json'), 'the cap cut one too many');
  assert.ok(!kept.includes('ancient.json'), 'an eight-day-old session survived');
}));

// A junction (Windows, no privilege needed) or a symlink: what a repo could commit in place of
// `activity/archive` or `activity/` to aim the sweep, or the writer, at any folder.
const linkDir = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('the sweep never follows a linked archive or activity dir', () => withBox((box) => {
  const victim = path.join(box, 'victim');
  fs.mkdirSync(victim);
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(victim, `v${i}.json`), JSON.stringify({ session_id: `v${i}`, updated_at: 0 }));
  }
  const d = path.join(box, 'activity');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'gone.json'), JSON.stringify({ session_id: 'gone', status: 'ended', updated_at: NOW }));
  linkDir(victim, path.join(d, 'archive'));
  sweepActivity(d, NOW);
  assert.deepEqual(fs.readdirSync(victim).sort(), ['v0.json', 'v1.json', 'v2.json'], 'the sweep wrote through a linked archive');
  assert.ok(fs.existsSync(path.join(d, 'gone.json')));
  // A linked `activity/` itself: neither the sweep nor the writer touches what it points at.
  const root = path.join(box, 'cfg');
  fs.mkdirSync(root);
  linkDir(victim, path.join(root, 'activity'));
  sweepActivity(path.join(root, 'activity'), NOW);
  assert.equal(recordActivity(root, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'x' }), { now: NOW }), false);
  assert.deepEqual(fs.readdirSync(victim).sort(), ['v0.json', 'v1.json', 'v2.json'], 'the writer wrote through a linked activity/');
}));

// The sweep moves and deletes only what a writer produced: a `safeStem` name holding an object
// with a string `session_id`. A user's file, an odd name and a garbage file are left alone —
// garbage is not "age 0".
test('the sweep leaves files no writer made', () => withBox((d) => {
  const arch = path.join(d, 'archive');
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(arch, 'notes.json'), JSON.stringify({ mine: true }));
  fs.writeFileSync(path.join(arch, 'two words.json'), JSON.stringify({ session_id: 'w', updated_at: 0 }));
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ updated_at: 0 }));
  fs.writeFileSync(path.join(arch, 'old.json'), JSON.stringify({ session_id: 'old', updated_at: 0 }));
  sweepActivity(d, NOW);
  assert.deepEqual(fs.readdirSync(arch).sort(), ['broken.json', 'notes.json', 'two words.json']);
  assert.ok(fs.existsSync(path.join(d, 'config.json')), 'a file with no session_id was moved');
}));

// ---------------------------------------------------------------------------------------------
// Through the real hook binary. A resolve hook logs every module URL the process loads, so
// "the writer is never imported when tracking is off" is an observation, not an inference —
// and the ON row is its control: a probe that logged nothing would pass the OFF row too.

function hook(root, argv, payload, env = {}) {
  const log = path.join(root, 'loaded.txt');
  const probe = path.join(root, 'probe.mjs');
  fs.writeFileSync(path.join(root, 'probe-hooks.mjs'), `import { appendFileSync } from 'node:fs';
export async function resolve(s, c, next) { const r = await next(s, c); appendFileSync(${JSON.stringify(log)}, r.url + '\\n'); return r; }\n`);
  fs.writeFileSync(probe, `import { register } from 'node:module';
register(${JSON.stringify(pathToFileURL(path.join(root, 'probe-hooks.mjs')).href)});\n`);
  try { fs.unlinkSync(log); } catch { /* first run */ }
  const e = { ...process.env };
  delete e.GENESEED_LEARN_CHILD;
  delete e.GENESEED_ACTIVITY;
  Object.assign(e, env);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(probe).href, HOOK, ...argv], {
    input: JSON.stringify(payload), encoding: 'utf8', env: e, cwd: root, windowsHide: true,
  });
  const loaded = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { rc: r.status, out: r.stdout, err: r.stderr, writer: /\/js\/hosts\/activity\.mjs$/m.test(loaded), loaded };
}

const PROMPT = { hook_event_name: 'UserPromptSubmit', session_id: 'sess', prompt: 'hi' };

test('tracking on: the activity verb records silently', () => withBox((root) => {
  const r = hook(root, ['activity', '--root', root], PROMPT);
  assert.deepEqual([r.rc, r.out, r.err], [0, '', '']);
  assert.ok(r.loaded.includes('/bin/geneseed-hook.mjs'), 'the probe saw nothing — the off rows would be vacuous');
  assert.equal(r.writer, true);
  assert.equal(readJson(path.join(root, 'activity', 'sess.json')).status, 'busy');
}));

test('tracking off by the flag file or the env: nothing written, writer never loaded', () => withBox((root) => {
  fs.writeFileSync(path.join(root, '.geneseed-activity'), 'off\n');
  for (const [argv, payload] of [
    [['activity', '--root', root], PROMPT],
    [['tool-gate', '--root', root], { hook_event_name: 'PreToolUse', session_id: 'sess', tool_name: 'Skill', tool_input: { skill: 'x' } }],
    [['context', '--root', root], { hook_event_name: 'SessionStart', session_id: 'sess' }],
    // learn names its install by `--memory`'s parent, not `--root`: the same flag file must hold.
    [['learn', '--memory', path.join(root, 'memory')], { hook_event_name: 'Stop', session_id: 'sess' }],
  ]) {
    const r = hook(root, argv, payload);
    assert.equal(r.rc, 0, argv[0]);
    assert.equal(r.writer, false, `${argv[0]} loaded the writer with tracking off`);
  }
  fs.unlinkSync(path.join(root, '.geneseed-activity'));
  const r = hook(root, ['activity', '--root', root], PROMPT, { GENESEED_ACTIVITY: 'off' });
  assert.equal(r.writer, false, '$GENESEED_ACTIVITY=off loaded the writer');
  assert.ok(!fs.existsSync(path.join(root, 'activity')));
}));

test('a gate verb records after its verdict, and its verdict is unchanged', () => withBox((root) => {
  // git-gate's own decision for a plain `git status` is silence; it must stay silence.
  const r = hook(root, ['git-gate', '--root', root], { hook_event_name: 'PreToolUse', session_id: 'g',
    tool_name: 'Bash', tool_input: { command: 'git status' } });
  assert.deepEqual([r.rc, r.out], [0, '']);
  assert.equal(readJson(path.join(root, 'activity', 'g.json')).phase, 'Bash');
}));

// `context` never read stdin before the writer, and Bob's SessionStart stdin is unverified, so
// on Bob the writer does not read it: nothing is recorded there.
test('a Bob SessionStart is not recorded', () => withBox((root) => {
  const r = hook(root, ['context', '--root', root, '--host', 'bob'],
    { event: 'SessionStart', session_id: 'b' });
  assert.equal(r.rc, 0);
  assert.ok(!fs.existsSync(path.join(root, 'activity')), 'context read stdin on Bob');
  // Control: the same call on Claude records, so the row above is not vacuous.
  hook(root, ['context', '--root', root], { hook_event_name: 'SessionStart', session_id: 'c' });
  assert.ok(fs.existsSync(path.join(root, 'activity', 'c.json')));
}));

test('a model-CLI child of learn records nothing', () => withBox((root) => {
  const r = hook(root, ['activity', '--root', root], PROMPT, { GENESEED_LEARN_CHILD: '1' });
  assert.equal(r.rc, 0);
  assert.ok(!fs.existsSync(path.join(root, 'activity')));
}));

test('the activity verb exits 0 on an argv error, never 2', () => withBox((root) => {
  const r = hook(root, ['activity', '--bogus'], PROMPT);
  assert.equal(r.rc, 0);
  assert.equal(r.out, '');
}));

// ---------------------------------------------------------------------------------------------
// The reader: a GET lists the ended beside the live and touches nothing.

test('a GET lists ended sessions and moves or deletes nothing', () => withBox((root) => {
  const d = path.join(root, 'activity');
  fs.mkdirSync(path.join(d, 'archive'), { recursive: true });
  const now = Date.now() / 1000;
  const put = (dir, e) => fs.writeFileSync(path.join(dir, `${e.session_id}.json`), JSON.stringify(e));
  put(d, { session_id: 'hook', status: 'busy', pid: null, updated_at: now });
  put(d, { session_id: 'dead', status: 'busy', pid: 2147483647, updated_at: now - 5 });
  put(d, { session_id: 'over', status: 'ended', pid: null, updated_at: now - 1 });
  put(path.join(d, 'archive'), { session_id: 'hook', status: 'ended', updated_at: now - 100 });
  put(path.join(d, 'archive'), { session_id: 'old', status: 'ended', updated_at: now - 200 });
  const listing = () => [d, path.join(d, 'archive')].flatMap((x) => fs.readdirSync(x)
    .map((n) => `${n}@${fs.statSync(path.join(x, n)).mtimeMs}`)).sort();
  const before = listing();
  const res = apiActivity({ target: root });
  assert.deepEqual(res.activity.map((e) => e.session_id), ['hook']);
  assert.deepEqual(res.ended.map((e) => [e.session_id, e.ended]),
    [['over', true], ['dead', true], ['old', true]]);
  assert.deepEqual(listing(), before, 'a GET changed the activity directory');

  assert.equal(apiActivityDetail({ target: root }, 'old').session.ended, true);
  assert.equal(apiActivityDetail({ target: root }, 'hook').session.ended, undefined);
}));

// The OpenCode plugin never sweeps, so its dead snapshots stay in `activity/`: the reader caps
// `ended` itself, by the archive's rule — the newest ARCHIVE_KEEP, none older than seven days.
test('the ended list is capped to the newest 50 within seven days', () => withBox((root) => {
  const d = path.join(root, 'activity');
  fs.mkdirSync(d, { recursive: true });
  const now = Date.now() / 1000;
  for (let i = 0; i < 60; i += 1) {
    fs.writeFileSync(path.join(d, `s${i}.json`), JSON.stringify({ session_id: `s${i}`,
      status: 'busy', pid: 2147483647, updated_at: now - 100 - i }));
  }
  fs.writeFileSync(path.join(d, 'ancient.json'), JSON.stringify({ session_id: 'ancient',
    status: 'ended', updated_at: now - 8 * 86400 }));
  const ended = apiActivity({ target: root }).ended.map((e) => e.session_id);
  assert.equal(ended.length, ARCHIVE_KEEP);
  assert.equal(ended[0], 's0');
  assert.equal(ended.at(-1), 's49');
  assert.ok(!ended.includes('ancient'));
  assert.equal(fs.readdirSync(d).length, 61, 'the cap deleted files');
  // The age cut alone, with room under the count cap: still no eight-day-old session.
  for (let i = 5; i < 60; i += 1) fs.unlinkSync(path.join(d, `s${i}.json`));
  assert.deepEqual(apiActivity({ target: root }).ended.map((e) => e.session_id),
    ['s0', 's1', 's2', 's3', 's4']);
}));
