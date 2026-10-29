// The ownership first-write gate (js/hosts/ownership-gate.mjs, spec 2026-10-26-ownership D4/D5/D12,
// rulings D25-D30), driven through the real hook entry as a child process. Written out, not
// recorded. The rule each row checks:
//   * an APPLICATION repo (a git root holding a D5 build manifest) whose root AGENTS.md has no
//     `## Ownership` heading outside the `<!-- BEGIN/END GENESEED -->` block is refused ONCE per
//     (session, repo): Claude gets `permissionDecision: "deny"` (the reason reaches the model),
//     Bob gets exit 2 with the one-time tail and never BOB_FINAL; the next write passes;
//   * everything else defers: no session, a sub-agent, a read, no git, no manifest at the root,
//     the setup's own files, a section with `mode: on` or `mode: off` (CRLF too), the off switch,
//     and the developer's personal `Setup: declined <YYYY-MM-DD>` line in `.geneseed/ownership.md`.
// Each row gets its own session id and every spawn's temp dir is a sandbox, so the per-session
// marker (`<tmpdir>/geneseed-ownership/<session>`) never leaks between rows or onto the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ROOT } from '../../js/build/source.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import { ownershipLine } from '../../js/hosts/ownership-gate.mjs';

const tmpBox = makeSandbox('gsown-tmp-');
test.after(() => tmpBox.cleanup());
const ENV = { ...process.env, TMP: tmpBox.path, TEMP: tmpBox.path, TMPDIR: tmpBox.path };

/** A repo in a fresh sandbox: `.git/`, then `files` ({ rel: text }). */
function repo(files = { 'package.json': '{}' }, git = true) {
  const sb = makeSandbox('gsown-');
  if (git) fs.mkdirSync(path.join(sb.path, '.git'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(sb.path, rel)), { recursive: true });
    fs.writeFileSync(path.join(sb.path, rel), text);
  }
  test.after(() => sb.cleanup());
  return sb.path;
}

const write = (file, extra = {}) => JSON.stringify({
  session_id: extra.session_id === undefined ? randomUUID() : extra.session_id,
  tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, ...extra,
});

function gate(stdin, { verb = 'rule-gate', extra = [], root = null } = {}) {
  const argv = [verb, ...(root ? ['--root', root] : []), ...extra];
  const r = spawnHook(argv, stdin, { env: ENV });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

function denied(r, what) {
  assert.equal(r.rc, 0, `${what}: exited ${r.rc}; stderr ${r.err}`);
  assert.ok(r.out.trim(), `${what}: expected a deny, got nothing`);
  const dec = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(dec.hookEventName, 'PreToolUse');
  assert.equal(dec.permissionDecision, 'deny', what);
  assert.match(dec.permissionDecisionReason, /^Geneseed \(Ownership\)/);
  assert.match(dec.permissionDecisionReason, /`mode: off`/, `${what}: names the per-repo opt-out`);
  assert.match(dec.permissionDecisionReason, /--no-ownership-gate/, `${what}: names the per-install opt-out`);
  return dec.permissionDecisionReason;
}

function defers(r, what) {
  assert.equal(r.rc, 0, `${what}: exited ${r.rc}`);
  assert.equal(r.out, '', `${what}: expected a defer, got ${JSON.stringify(r.out)}`);
}

test('an application with no AGENTS.md is refused once per session, then passes', () => {
  const app = repo();
  const sid = randomUUID();
  const why = denied(gate(write(path.join(app, 'src', 'a.js'), { session_id: sid })), 'first write');
  assert.match(why, /has no `AGENTS.md` with `## Ownership`/);
  // D5: three answers, and the decline is written only on the third.
  assert.match(why, /set it up now \(ownership skill\); skip this session; or skip in this repo until they ask/);
  assert.match(why, /only on that third answer, write the line `Setup: declined <YYYY-MM-DD>`/);
  // The line goes to the MAIN worktree (ruling 2026-10-29), with its `.gitignore` beside it.
  assert.match(why, /into `\.geneseed\/ownership\.md` at the MAIN worktree's root/, 'the decline outlives a worktree');
  assert.match(why, /if `\.geneseed\/\.gitignore` is absent there, create it first/, 'the decline stays personal');
  defers(gate(write(path.join(app, 'src', 'b.js'), { session_id: sid })), 'second write, same session');
  denied(gate(write(path.join(app, 'src', 'a.js'))), 'a new session is refused again');
});

test('one session is refused once in EACH application it writes to', () => {
  const [a, b] = [repo(), repo()];
  const sid = randomUUID();
  denied(gate(write(path.join(a, 'x.js'), { session_id: sid })), 'repo a');
  denied(gate(write(path.join(b, 'x.js'), { session_id: sid })), 'repo b');
  defers(gate(write(path.join(a, 'y.js'), { session_id: sid })), 'repo a again');
});

test('every D5 manifest family makes an application', () => {
  for (const m of ['pom.xml', 'build.gradle.kts', 'pyproject.toml', 'go.mod', 'Cargo.toml',
    'App.csproj', 'composer.json', 'Gemfile']) {
    denied(gate(write(path.join(repo({ [m]: '' }), 'x'))), m);
  }
});

test('Geneseed\'s managed block alone does not count: its `#### Ownership` is not the section', () => {
  const app = repo({ 'package.json': '{}',
    'AGENTS.md': '<!-- BEGIN GENESEED -->\n#### Ownership\n## Ownership\nmode: on\n<!-- END GENESEED -->\n' });
  assert.match(denied(gate(write(path.join(app, 'x.js'))), 'block only'), /has no `AGENTS.md` with/);
});

test('a hand-written AGENTS.md without the section gets the lighter proposal', () => {
  const app = repo({ 'package.json': '{}', 'AGENTS.md': '# Notes\n\nRun `npm test`.\n' });
  assert.match(denied(gate(write(path.join(app, 'x.js'))), 'hand-written'),
    /has no `## Ownership` section\. Before writing, ask the developer: add the Ownership section/);
});

test('a `## Ownership` section, on or off, LF or CRLF, outside the block, defers', () => {
  for (const [label, text] of [
    ['mode: on', '# x\n\n## Ownership\n\nmode: on\n'],
    ['mode: off', '# x\n\n## Ownership\n\nmode: off\n'],
    ['CRLF off', '# x\r\n\r\n## Ownership\r\n\r\nmode: off\r\n'],
    ['beside the block', '<!-- BEGIN GENESEED -->\nx\n<!-- END GENESEED -->\n## Ownership \nmode: on\n'],
  ]) {
    defers(gate(write(path.join(repo({ 'package.json': '{}', 'AGENTS.md': text }), 'x.js'))), label);
  }
});

test('Geneseed\'s own repo stays silent: its root AGENTS.md says mode: off', () => {
  defers(gate(write(path.join(ROOT, 'js', 'hosts', 'x.mjs'))), 'this checkout');
});

test('no git, no manifest at the git root, or a manifest only below it: defer', () => {
  defers(gate(write(path.join(repo({ 'package.json': '{}' }, false), 'x.js'))), 'no git');
  defers(gate(write(path.join(repo({ 'README.md': '' }), 'x.js'))), 'no manifest');
  defers(gate(write(path.join(repo({ 'web/package.json': '{}' }), 'web', 'x.js'))), 'manifest in a subdirectory');
});

// D2/D3: the developer's durable, personal decline — `Setup: declined <YYYY-MM-DD>` alone on a
// line of `.geneseed/ownership.md` (CRLF too) — defers every write, in every session, with no
// expiry. A malformed line (no date, another format, words after it) matches nothing, so the gate
// behaves as before. A section in AGENTS.md, on or off, outranks the line either way.
test('a `Setup: declined <date>` line in .geneseed/ownership.md defers; a malformed one does not', () => {
  for (const [label, text] of [
    ['LF', 'Setup: declined 2026-10-29\n'],
    ['CRLF, among other state', 'Granularity: team\r\nSetup: declined 2026-10-29\r\n## Decisions\r\n'],
  ]) {
    defers(gate(write(path.join(repo({ 'package.json': '{}', '.geneseed/ownership.md': text }), 'x.js'))), label);
  }
  for (const [label, text] of [
    ['no date', 'Setup: declined\n'],
    ['another date format', 'Setup: declined 29/10/2026\n'],
    ['words after it', 'Setup: declined 2026-10-29 for now\n'],
    ['indented', '  Setup: declined 2026-10-29\n'],
  ]) {
    denied(gate(write(path.join(repo({ 'package.json': '{}', '.geneseed/ownership.md': text }), 'x.js'))), label);
  }
  defers(gate(write(path.join(repo({ 'package.json': '{}', 'AGENTS.md': '## Ownership\nmode: on\n',
    '.geneseed/ownership.md': 'Setup: declined 2026-10-29\n' }), 'x.js'))), 'section and line');
});

test('ownershipLine: the SessionStart reminder, written out', () => {
  const line = 'Ownership: setup declined since 2026-10-29 — not set up; say "set up ownership" to run it';
  const declined = { 'package.json': '{}', '.geneseed/ownership.md': 'Setup: declined 2026-10-29\n' };
  assert.equal(ownershipLine(repo(declined)), line, 'a declined application');
  assert.equal(ownershipLine(repo()), null, 'no decline line');
  assert.equal(ownershipLine(repo({ ...declined, 'AGENTS.md': '## Ownership\nmode: off\n' })), null,
    'a section, even mode: off, outranks the line');
  assert.equal(ownershipLine(repo({ 'README.md': '', '.geneseed/ownership.md': 'Setup: declined 2026-10-29\n' })),
    null, 'not an application');
  assert.equal(ownershipLine(repo({ ...declined, 'AGENTS.md': '<!-- BEGIN GENESEED -->\n## Ownership\n<!-- END GENESEED -->\n' })),
    line, 'the managed block\'s heading is not the section');
  assert.equal(ownershipLine(null), null, 'no git root');
});

test('the setup\'s own files are never what the gate stops', () => {
  const app = repo();
  defers(gate(write(path.join(app, 'AGENTS.md'))), 'AGENTS.md');
  defers(gate(write(path.join(app, '.geneseed', 'ownership.md'))), '.geneseed/ownership.md');
});

test('no session, a sub-agent, or the off switch: defer', () => {
  const app = repo();
  defers(gate(write(path.join(app, 'x.js'), { session_id: null })), 'no session_id');
  defers(gate(write(path.join(app, 'x.js'), { agent_id: 'a1' })), 'agent_id (D29)');
  defers(gate(write(path.join(app, 'x.js')), { extra: ['--no-ownership-gate'] }), '--no-ownership-gate');
  defers(gate(write(path.join(app, 'x.js')), { verb: 'tool-gate', extra: ['--no-ownership-gate'] }),
    'tool-gate --no-ownership-gate');
});

test('a refusal is ledgered under `ownership`', () => {
  const app = repo();
  const install = repo({ 'notebook/.keep': '' });   // the ledger writes only into an existing notebook/
  denied(gate(write(path.join(app, 'x.js')), { root: install }), 'with --root');
  const lines = fs.readFileSync(path.join(install, 'notebook', 'gates.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(lines.map((l) => [JSON.parse(l).verb, JSON.parse(l).rule]), [['rule-gate', 'ownership']]);
});

test('Bob: exit 2 with the one-time tail, never BOB_FINAL; a read defers', () => {
  const app = repo();
  const sid = randomUUID();
  const bob = (tool, input) => JSON.stringify({ event: 'PreToolUse', session_id: sid, tool, input });
  defers(gate(bob('read_file', { path: path.join(app, 'x.js') }), { verb: 'tool-gate', extra: ['--host', 'bob'] }),
    'read_file');
  const r = gate(bob('write_to_file', { path: path.join(app, 'x.js'), content: 'x' }),
    { verb: 'tool-gate', extra: ['--host', 'bob'] });
  assert.equal(r.rc, 2, `Bob refuses by exit code; stderr ${r.err}`);
  assert.equal(r.out, '');
  assert.match(r.err, /BLOCKED: Geneseed \(Ownership\)/);
  assert.match(r.err, /one-time, not final/);
  assert.doesNotMatch(r.err, /no approval step for this gate/, 'BOB_FINAL is false here: the retry passes');
  const again = gate(bob('write_to_file', { path: path.join(app, 'x.js'), content: 'x' }),
    { verb: 'tool-gate', extra: ['--host', 'bob'] });
  assert.equal(again.rc, 0, 'the same write passes the second time');
});

test('a sub-agent\'s deferred write does not spend the block: the parent is still refused', () => {
  // D29 defers a sub-agent BEFORE the marker is written, so the parent's first write in the
  // same session and repo is still the one the gate stops.
  const app = repo();
  const sid = randomUUID();
  defers(gate(write(path.join(app, 'a.js'), { session_id: sid, agent_id: 'worker-1' })), 'sub-agent');
  denied(gate(write(path.join(app, 'b.js'), { session_id: sid })), 'the parent, after the sub-agent');
});

test('an earlier gate\'s ask comes first and does not spend the ownership block', () => {
  // A secret-bearing write is answered by the secrets gate (an `ask`); the ownership gate runs
  // only on the path where every earlier gate let the write through, so the session's next
  // clean write is still refused once.
  const app = repo();
  const sid = randomUUID();
  const secret = JSON.stringify({ session_id: sid, tool_name: 'Write',
    tool_input: { file_path: path.join(app, 'cfg.js'), content: 'const k = "AKIAIOSFODNN7EXAMPLE";' } });
  const r = gate(secret);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'ask', 'the secrets gate asks');
  denied(gate(write(path.join(app, 'b.js'), { session_id: sid })), 'the next clean write');
});

test('the install\'s own bookkeeping never spends the block', () => {
  // A write under `--root` (the install dir: memory, notebook) defers, so harness housekeeping
  // never uses up the one refusal the developer is meant to see.
  const app = repo();
  const install = path.join(app, '.claude');
  const sid = randomUUID();
  defers(gate(write(path.join(install, 'notebook', 'ledger.md'), { session_id: sid }), { root: install }),
    'a write under the install root');
  denied(gate(write(path.join(app, 'a.js'), { session_id: sid }), { root: install }), 'the first real write');
});

test('an unwritable marker defers: the gate never blocks without a way to let the retry pass', () => {
  // If the per-session marker cannot be written (TMP is a FILE here), a refusal could never be
  // lifted by the retry, so the gate stands down instead.
  const app = repo();
  const file = path.join(tmpBox.path, 'not-a-dir');
  fs.writeFileSync(file, '');
  const r = spawnHook(['rule-gate'], write(path.join(app, 'a.js')),
    { env: { ...process.env, TMP: file, TEMP: file, TMPDIR: file } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', `expected a defer, got ${JSON.stringify(r.stdout)}`);
});
