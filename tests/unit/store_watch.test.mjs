// The change report, through the real hook entry and the real guard. Expected lines are written out.
// A baseline at SessionStart, a compare at Stop: what is said, to whom, and what is excused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { recordOwnWrites, storeLine } from '../../js/hosts/store-watch.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

function world(prefix) {
  const sb = makeSandbox(prefix);
  const root = path.join(sb.path, 'install');
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notebook'), { recursive: true });
  fs.writeFileSync(path.join(root, 'user-rules.md'), 'rules');
  fs.writeFileSync(path.join(root, 'memory', 'a.md'), 'fact');
  const env = { ...process.env, ...homeOverrides(sb.path) };
  for (const k of ['GENESEED_LLM', 'GENESEED_MEMORY', 'GENESEED_HARNESS']) delete env[k];
  const start = (host) => spawnHook(['context', '--root', root, ...(host ? ['--host', host] : [])],
    JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd: sb.path }), { env, cwd: sb.path });
  const stop = (extra = {}, host = null) => spawnHook(['learn', '--memory', path.join(root, 'memory'), '--no-done-gate', ...(host ? ['--host', host] : [])],
    JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: sb.path, ...extra }), { env, cwd: sb.path });
  return { sb, root, env, start, stop };
}
const LINE = (n, names) => `Geneseed change report: ${n} rule or memory file${n === 1 ? '' : 's'} changed outside this session's approved writes (another session, or a decision of yours in the web console, may have made it): ${names}. This detects a change; it prevented nothing.`;
const message = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).systemMessage : null);
const tool = (id, name, file) => JSON.stringify({ message: { content: [{ type: 'tool_use', id, name, input: { file_path: file } }] } });
const result = (id, isError) => JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });

test('nothing changed: Stop prints nothing, and SessionStart wrote no tracked file', () => {
  const w = world('sw-quiet-');
  try {
    w.start();
    assert.ok(fs.existsSync(path.join(w.root, 'notebook', 'store-baseline', 's1.json')));
    assert.equal(message(w.stop()), null);
  } finally { w.sb.cleanup(); }
});

test('an unapproved change is said once, on the visible channel', () => {
  const w = world('sw-said-');
  try {
    w.start();
    fs.appendFileSync(path.join(w.root, 'user-rules.md'), ' changed');
    fs.writeFileSync(path.join(w.root, 'memory', 'new.md'), 'planted');
    assert.equal(message(w.stop()), LINE(2, 'memory/new.md, install/user-rules.md'));
    assert.equal(message(w.stop()), null, 'the baseline rolled');
  } finally { w.sb.cleanup(); }
});

test('a deleted fact counts, and a resumed session keeps its first baseline', () => {
  const w = world('sw-del-');
  try {
    w.start();
    fs.rmSync(path.join(w.root, 'memory', 'a.md'));
    w.start();
    assert.equal(message(w.stop()), LINE(1, 'memory/a.md'));
  } finally { w.sb.cleanup(); }
});

test('a write the transcript shows ran is approved; a failed one, or another file, is not', () => {
  const w = world('sw-appr-');
  try {
    const rules = path.join(w.root, 'user-rules.md');
    const fact = path.join(w.root, 'memory', 'a.md');
    const log = path.join(w.sb.path, 't.jsonl');
    w.start();
    fs.appendFileSync(rules, ' host approved');
    fs.appendFileSync(fact, ' planted');
    fs.writeFileSync(log, [tool('t1', 'Write', rules), result('t1', false), tool('t2', 'Edit', fact), result('t2', true)].join('\n'));
    assert.equal(message(w.stop({ transcript_path: log })), LINE(1, 'memory/a.md'));
  } finally { w.sb.cleanup(); }
});

test("Geneseed's own writes are not reported; a later change to the same file is", () => {
  const w = world('sw-own-');
  try {
    w.start();
    recordOwnWrites(w.root, () => fs.writeFileSync(path.join(w.root, 'memory', 'learned.md'), 'distilled'));
    assert.equal(message(w.stop()), null);
    fs.appendFileSync(path.join(w.root, 'memory', 'learned.md'), ' tampered');
    assert.equal(message(w.stop()), LINE(1, 'memory/learned.md'));
  } finally { w.sb.cleanup(); }
});

test('Bob: stdout stays empty, and the line goes to stderr', () => {
  const w = world('sw-bob-');
  try {
    w.start('bob');
    fs.appendFileSync(path.join(w.root, 'user-rules.md'), ' changed');
    const r = w.stop({}, 'bob');
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(LINE(1, 'install/user-rules.md')), r.stderr);
  } finally { w.sb.cleanup(); }
});

test('a gate verb never prints the report, and SessionStart prints nothing of it', () => {
  const w = world('sw-gate-');
  try {
    const started = w.start();
    assert.doesNotMatch(started.stdout, /change report/);
    fs.appendFileSync(path.join(w.root, 'user-rules.md'), ' changed');
    const gate = spawnHook(['git-gate', '--root', w.root], JSON.stringify({ tool_name: 'Bash', session_id: 's1', tool_input: { command: 'ls' } }), { env: w.env, cwd: w.sb.path });
    assert.equal(gate.stdout, '');
  } finally { w.sb.cleanup(); }
});

test('an unwritable status file does not swallow the report', () => {
  const w = world('sw-status-');
  try {
    fs.mkdirSync(path.join(w.sb.path, '.config', 'geneseed', '.store-report.json'), { recursive: true });
    w.start();
    fs.appendFileSync(path.join(w.root, 'user-rules.md'), ' changed');
    assert.equal(message(w.stop()), LINE(1, 'install/user-rules.md'));
  } finally { w.sb.cleanup(); }
});

test('the line names five files and counts the rest', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => path.join('x', 'memory', `${n}.md`));
  assert.equal(storeLine(files), "Geneseed change report: 7 rule or memory files changed outside this session's approved writes (another session, or a decision of yours in the web console, may have made it): "
    + 'memory/a.md, memory/b.md, memory/c.md, memory/d.md, memory/e.md (+2 more). This detects a change; it prevented nothing.');
});

test('V1: the guard reports through a toast, excuses a host-approved edit, and never throws', async () => {
  const sb = makeSandbox('sw-v1-');
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
    const copy = path.join(cfg, 'plugins', 'geneseed-guard.js');
    fs.copyFileSync(path.resolve('adapters/opencode/plugins/geneseed-guard.js'), copy);
    const { GeneseedGuard } = await import(pathToFileURL(copy).href);
    const toasts = [];
    const h = await GeneseedGuard({ directory: sb.path, worktree: sb.path, client: { tui: { showToast: async (o) => { toasts.push(o.body.message); } } } });
    const ev = (type, properties) => h.event({ event: { type, properties } });
    const fact = path.join(cfg, 'memory', 'x.md');
    await ev('session.created', { info: { id: 's' } });
    fs.writeFileSync(fact, 'one');
    await h['tool.execute.after']({ tool: 'write', args: { filePath: fact } }, {});
    await ev('session.idle', { sessionID: 's' });
    assert.deepEqual(toasts, [], 'the host let that write through');
    fs.writeFileSync(fact, 'planted by a shell');
    await ev('session.idle', { sessionID: 's' });
    assert.deepEqual(toasts, [LINE(1, 'memory/x.md')]);
    // The learn plugin's log, as it writes one: this exact stamp is Geneseed's own.
    fs.writeFileSync(fact, 'distilled');
    const st = fs.statSync(fact);
    fs.writeFileSync(path.join(cfg, 'memory', '.own-writes.json'), JSON.stringify({ [fact]: `${st.size}:${Math.trunc(st.mtimeMs)}` }));
    await ev('session.idle', { sessionID: 's' });
    assert.equal(toasts.length, 1, 'an own write is not reported');
    // Approved through a link: the link's own spelling is no store file, so it must not read as gone.
    const link = path.join(sb.path, 'via-link.md');
    let linked = true;
    try { fs.symlinkSync(fact, link, 'file'); } catch { linked = false; }
    if (linked) {
      fs.writeFileSync(fact, 'through the link');
      await h['tool.execute.after']({ tool: 'write', args: { filePath: link } }, {});
      await ev('session.idle', { sessionID: 's' });
      assert.equal(toasts.length, 1, 'no phantom file from the link');
    }
    // A new file the host let through, and a session that never sent `session.created`.
    const fresh = path.join(cfg, 'memory', 'fresh.md');
    fs.writeFileSync(fresh, 'new');
    await h['tool.execute.after']({ tool: 'write', args: { filePath: fresh } }, {});
    await ev('session.idle', { sessionID: 's' });
    assert.equal(toasts.length, 1, 'a new approved file is no change');
    await h['tool.execute.before']({ tool: 'read', sessionID: 'late' }, { args: { filePath: 'a.txt' } });
    fs.writeFileSync(fact, 'planted later');
    await ev('session.idle', { sessionID: 'late' });
    assert.equal(toasts.length, 2, 'the first tool call took the baseline');
    await assert.doesNotReject(h.event({}));
    await assert.doesNotReject(h['tool.execute.after'](null, null));
    const broken = await GeneseedGuard({ directory: sb.path, worktree: sb.path, client: { tui: { showToast: async () => { throw new Error('no tui'); } } } });
    await broken.event({ event: { type: 'session.created', properties: { info: { id: 'b' } } } });
    fs.writeFileSync(fact, 'again');
    await assert.doesNotReject(broken.event({ event: { type: 'session.idle', properties: { sessionID: 'b' } } }));
  } finally {
    if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
    sb.cleanup();
  }
});
