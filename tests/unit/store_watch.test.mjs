// The change report, through the real hook entry and the real guard. Expected lines are written out.
// A baseline at SessionStart, a compare at Stop: what is said, to whom, and what is excused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

// The post-suite gate, against a sandboxed tier: the leak's own shape goes red, a real report stays green.
test('shim_intact: the machine tier fails on a test fixture, and passes a real report', () => {
  const sb = makeSandbox('sw-tier-');
  try {
    const tier = path.join(sb.path, '.config', 'geneseed');
    fs.mkdirSync(tier, { recursive: true });
    const run = () => spawnSync(process.execPath, ['tests/shim_intact.mjs'], { env: { ...process.env, ...homeOverrides(sb.path) }, encoding: 'utf8' });
    const report = (f) => fs.writeFileSync(path.join(tier, '.store-report.json'), JSON.stringify({ files: [f] }));
    assert.equal(run().status, 0, 'an empty tier');
    report(path.resolve('adapters/opencode/memory/w2g-report.md'));
    const inCheckout = run();
    assert.equal(inCheckout.status, 1);
    assert.match(inCheckout.stderr, /w2g-report\.md/);
    report(path.join(os.tmpdir(), 'gs-x', 'memory', 'a.md'));
    assert.equal(run().status, 1, 'a path in the temp root');
    report(path.join(path.parse(process.cwd()).root, 'home-of-a-real-install', 'user-rules.md'));
    assert.equal(run().status, 0, 'a real store');
    report(path.resolve('Harness/memory/a.md'));
    assert.equal(run().status, 0, 'the project install a checkout may hold is a real store too');
    fs.writeFileSync(path.join(tier, '.suite-fence'), '');
    const fenced = run();
    assert.equal(fenced.status, 1, 'behind the fence, any file is a leak');
    assert.match(fenced.stderr, /\.store-report\.json/);
    fs.rmSync(path.join(tier, '.store-report.json'));
    assert.equal(run().status, 0, 'the fence alone');
  } finally { sb.cleanup(); }
});

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

// The rule draft and the project layer's rule files are rules too: the context hook loads the project's
// from the session's repository (its git root, else the cwd), so the baseline stamps them there.
test('the rule draft and the project layer\'s rule files are baselined and reported', () => {
  const w = world('sw-layer-');
  try {
    const draft = path.join(w.root, 'user-rules.draft.md');
    const project = path.join(w.sb.path, 'user-rules.md');
    fs.writeFileSync(draft, 'draft');
    fs.writeFileSync(project, 'project rules');
    w.start();
    fs.appendFileSync(draft, ' planted');
    fs.appendFileSync(project, ' planted');
    assert.equal(message(w.stop()), LINE(2, `install/user-rules.draft.md, ${path.basename(w.sb.path)}/user-rules.md`));
    // A repo's own memory/ folder is no store, at the project layer too.
    fs.mkdirSync(path.join(w.sb.path, 'memory'));
    fs.writeFileSync(path.join(w.sb.path, 'memory', 'notes.md'), 'repo notes');
    assert.equal(message(w.stop()), null);
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

// Process 1 excluded (`--no-rule-store`, owner decision 2026-11-08): a rule write runs with no prompt,
// so the transcript proves no approval and the report still names it. Memory keeps its excuse.
test('with process 1 excluded a rule write the transcript shows is still reported; memory is still excused', () => {
  const w = world('sw-norule-');
  try {
    const rules = path.join(w.root, 'user-rules.md');
    const draft = path.join(w.root, 'user-rules.draft.md');
    const fact = path.join(w.root, 'memory', 'a.md');
    const log = path.join(w.sb.path, 't.jsonl');
    fs.writeFileSync(draft, 'draft');
    w.start();
    fs.appendFileSync(rules, ' unprompted');
    fs.appendFileSync(draft, ' unprompted');
    fs.appendFileSync(fact, ' the agent\'s own');
    fs.writeFileSync(log, [tool('t1', 'Write', rules), result('t1', false), tool('t2', 'Edit', draft), result('t2', false),
      tool('t3', 'Edit', fact), result('t3', false)].join('\n'));
    const r = spawnHook(['learn', '--memory', path.join(w.root, 'memory'), '--no-done-gate', '--no-rule-store'],
      JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: w.sb.path, transcript_path: log }), { env: w.env, cwd: w.sb.path });
    assert.equal(message(r), LINE(2, 'install/user-rules.draft.md, install/user-rules.md'));
  } finally { w.sb.cleanup(); }
});

// On Stop, stdout holds at most one JSON document. The change report is that document, so nothing
// the model CLI does may add to it: a reply of NOTHING is dropped, a reply that is no memory
// stores nothing and says so on stderr, and a model CLI that exits 2 neither blocks the Stop nor changes stdout. In
// every row stdout is exactly the one line written out below, and rc is 0. Before this, the raw
// reply followed the report on stdout: two documents, which no host parses, so the report was lost.
test('Stop with a changed store prints the change report alone, whatever the model CLI says', () => {
  const w = world('sw-llm-');
  try {
    const stub = path.join(w.sb.path, 'llm.mjs');
    fs.writeFileSync(stub, 'process.stdout.write(process.env.SAYS); process.stderr.write(process.env.FAILS ?? "");'
      + ' process.exit(Number(process.env.RC ?? 0));\n');
    const log = path.join(w.sb.path, 't.jsonl');
    fs.writeFileSync(log, `${JSON.stringify({ message: { role: 'user', content: 'a turn worth distilling' } })}\n`);
    w.start();
    const ONE = '{"systemMessage":"Geneseed change report: 1 rule or memory file changed outside this session\'s approved writes '
      + '(another session, or a decision of yours in the web console, may have made it): install/user-rules.md. '
      + 'This detects a change; it prevented nothing."}\n';
    for (const [says, extra, stderr] of [
      ['NOTHING\n', {}, ''],
      ['nothing', {}, ''],
      ['I could not find anything durable.\n', {}, '[learn] nothing new to store (all duplicates).\n'],
      ['NOTHING\n', { RC: '2', FAILS: 'quota exceeded\n' }, 'quota exceeded\n'],
    ]) {
      // A report is said once, so each row changes the rule file again before its Stop.
      fs.appendFileSync(path.join(w.root, 'user-rules.md'), ' changed');
      const r = spawnHook(['learn', '--memory', path.join(w.root, 'memory'), '--no-done-gate'],
        JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: w.sb.path, transcript_path: log }),
        { env: { ...w.env, GENESEED_LLM: `node ${stub}`, SAYS: says, ...extra }, cwd: w.sb.path });
      const what = JSON.stringify([says, extra]);
      assert.equal(r.status, 0, `${what}: ${r.stderr}`);
      assert.equal(r.stdout.replace(/\r\n/g, '\n'), ONE, what);
      assert.equal(r.stderr.replace(/\r\n/g, '\n'), stderr, what);
    }
  } finally { w.sb.cleanup(); }
});

test('V1 with process 1 excluded: a native edit of a rule file is still reported; memory is still excused', async () => {
  const sb = makeSandbox('sw-v1-norule-');
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
    // The carrier the guard reads its state from, as the build writes it.
    fs.writeFileSync(path.join(cfg, 'AGENT.md'), 'Active packs: craft, rigor, ops, process, comms\nExcluded rules: process 1\n');
    const rules = path.join(cfg, 'user-rules.md');
    const fact = path.join(cfg, 'memory', 'x.md');
    fs.writeFileSync(rules, 'rules');
    const copy = path.join(cfg, 'plugins', 'geneseed-guard.js');
    fs.copyFileSync(path.resolve('adapters/opencode/plugins/geneseed-guard.js'), copy);
    const { GeneseedGuard } = await import(pathToFileURL(copy).href);
    const toasts = [];
    const h = await GeneseedGuard({ directory: sb.path, worktree: sb.path, client: { tui: { showToast: async (o) => { toasts.push(o.body.message); } } } });
    const ev = (type, properties) => h.event({ event: { type, properties } });
    await ev('session.created', { info: { id: 's' } });
    fs.writeFileSync(fact, 'one');
    fs.appendFileSync(rules, ' unprompted');
    for (const f of [fact, rules]) await h['tool.execute.after']({ tool: 'write', args: { filePath: f } }, {});
    await ev('session.idle', { sessionID: 's' });
    assert.deepEqual(toasts, [LINE(1, 'cfg/user-rules.md')]);
  } finally {
    if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
    sb.cleanup();
  }
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
    // Approved under this machine's admin share or a device path: the same file, so no report.
    if (process.platform === 'win32') {
      for (const spelled of [`\\\\localhost\\${fact[0].toLowerCase()}$\\${fact.slice(3)}`, `\\\\?\\${fact}`]) {
        fs.appendFileSync(fact, ' approved');
        await h['tool.execute.after']({ tool: 'write', args: { filePath: spelled } }, {});
        await ev('session.idle', { sessionID: 's' });
        assert.equal(toasts.length, 1, `an approved write spelled ${spelled}`);
      }
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
    // The project layer's rule file, at the session's directory, is watched too (twin of the hook's).
    fs.writeFileSync(path.join(sb.path, 'user-rules.draft.md'), 'project draft');
    await ev('session.idle', { sessionID: 's' });
    assert.equal(toasts.at(-1), LINE(2, `memory/x.md, ${path.basename(sb.path)}/user-rules.draft.md`));
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
