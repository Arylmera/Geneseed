// The ownership first-write gate (js/hosts/ownership-gate.mjs, spec 2026-10-26-ownership D4/D5/D12,
// rulings D25-D30), driven through the real hook entry as a child process. Written out, not
// recorded. The rule each row checks:
//   * an APPLICATION repo (a git root holding a D5 build manifest) whose root AGENTS.md has no
//     `## Ownership` heading outside the `<!-- BEGIN/END GENESEED -->` block is refused ONCE per
//     (session, repo): Claude gets `permissionDecision: "deny"` (the reason reaches the model),
//     Bob gets exit 2 with the one-time tail and never BOB_FINAL; the next write passes;
//   * everything else defers: no session, a sub-agent, a read, no git, no manifest at the root,
//     the setup's own files, a section with `mode: on` or `mode: off` (CRLF too), the off switch.
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
  assert.match(why, /proceed without for this session/);
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
