// Context Mode (mksglu/context-mode) moves shell work into its MCP tools on purpose: `ctx_execute`
// carries a command as `code` beside a shell-family `language`, and `ctx_batch` carries a
// `commands` list (`string[]` in v2.2.2; older releases' `ctx_batch_execute` sent
// `[{ label, command }]`). Shapes read from v2.2.2 `src/core/tools/{execute,batch}.ts`. The
// git-gate read only `tool_input.command`, and Claude's PreToolUse matcher named only the built-in
// shells, so `rm -rf /` through either tool reached no gate. Each row goes through the real entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';

const EXEC = 'mcp__context-mode__ctx_execute';
const BATCH = 'mcp__plugin_context-mode_context-mode__ctx_batch';

function run(verb, payload, { host = null, cwd = null } = {}) {
  const argv = [verb, ...(host ? ['--host', host] : [])];
  const p = spawnHook(argv, JSON.stringify(payload), cwd ? { cwd } : {});
  return { rc: p.status, out: p.stdout, err: p.stderr };
}
// Claude's verdict: 'ask', 'deny' or 'defer' (exit 0 and nothing on stdout).
function verdict(r, what) {
  assert.equal(r.rc, 0, `${what}: exit ${r.rc}, stderr ${r.err}`);
  return r.out.trim() ? JSON.parse(r.out).hookSpecificOutput.permissionDecision : 'defer';
}

const ROWS = [
  // [label, tool_name, tool_input, Claude verdict]
  ['ctx_execute: rm -rf / as shell code', EXEC, { language: 'shell', code: 'rm -rf /' }, 'ask'],
  ['ctx_execute: a shell-family runtime name', EXEC, { language: 'Bash', code: 'rm -rf ~' }, 'ask'],
  ['ctx_execute: PowerShell code', EXEC, { language: 'powershell', code: 'Remove-Item -Recurse -Force C:\\' }, 'ask'],
  ['ctx_execute: an ordinary shell command', EXEC, { language: 'shell', code: 'git status' }, 'defer'],
  // A KNOWN GAP, pinned so that closing it is a visible change: script code that starts a shell
  // itself (`os.system`, `child_process`) is not read. Non-shell code is not read as a command.
  ['ctx_execute: python code is not read as a shell command (known gap)', EXEC, { language: 'python', code: 'rm -rf /' }, 'defer'],
  ['ctx_batch: one destructive command among several', BATCH, { commands: ['git log -5', 'rm -rf /'], queries: ['x'] }, 'ask'],
  ['ctx_batch_execute: a destructive { label, command } item', 'mcp__context-mode__ctx_batch_execute',
    { commands: [{ label: 'log', command: 'git log -5' }, { label: 'wipe', command: 'rm -rf /' }], queries: ['x'] }, 'ask'],
  ['ctx_batch: ordinary commands', BATCH, { commands: ['git status', { label: 'l', command: 'ls' }], queries: ['x'] }, 'defer'],
];

test('git-gate judges the shell commands Context Mode tools carry', () => {
  for (const [label, tool_name, tool_input, want] of ROWS) {
    assert.equal(verdict(run('git-gate', { tool_name, tool_input }), label), want, label);
  }
});

test('Bob routes a Context Mode payload to the shell gate and refuses the catastrophic ones', () => {
  // Bob has no matcher: tool-gate picks the gate from the payload, so a call with no `command`
  // field went to the write gate, which passes a shell command.
  for (const [label, tool_name, tool_input, want] of ROWS) {
    const r = run('tool-gate', { tool_name, tool_input }, { host: 'bob' });
    assert.equal(r.rc === 0 ? 'pass' : 'blocked', want === 'ask' ? 'blocked' : 'pass', `${label}: ${r.err}`);
  }
});

test('the batch stops at its first verdict and prints exactly one', () => {
  const r = run('git-gate', { tool_name: BATCH, tool_input: { commands: ['rm -rf /', 'rm -rf ~'], queries: ['x'] } });
  assert.equal(verdict(r, 'two refused commands'), 'ask');
  assert.equal(r.out.trim().split('\n').length, 1, r.out);
  assert.match(JSON.parse(r.out).hookSpecificOutput.permissionDecisionReason, /"rm -rf \/"/);
});

// `shell` runs in Git Bash on Windows and `sh` elsewhere (v2.2.2 `src/core/sandbox/runtimes.ts`),
// so `shell` code and every batch entry are read as bash; `powershell` code as PowerShell. A
// call read in neither dialect is read as PowerShell on Windows and as POSIX elsewhere
// (`shellReading`), so the first two rows are missed by that reading on Windows and the third
// elsewhere: a `\`-newline joins a bash line, a backtick-newline a PowerShell one.
test('Context Mode code is read in the dialect its shell runs', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.geneseed'));
    fs.writeFileSync(path.join(repo, '.geneseed', 'protected-checks.txt'), 'ci/verify.sh\n');
    for (const [tool_name, tool_input] of [
      [EXEC, { language: 'shell', code: 'echo x > ci/ver\\\nify.sh' }],
      [BATCH, { commands: ['echo x > ci/ver\\\nify.sh'], queries: ['x'] }],
      [EXEC, { language: 'powershell', code: 'echo x > ci/ver`\nify.sh' }],
    ]) {
      const what = JSON.stringify(tool_input);
      const r = run('git-gate', { tool_name, tool_input, cwd: repo }, { cwd: repo });
      assert.equal(verdict(r, what), 'ask', what);
      assert.match(JSON.parse(r.out).hookSpecificOutput.permissionDecisionReason, /protected check/, what);
    }
  } finally { sb.cleanup(); }
});

test("Claude's shell-gate matcher routes Context Mode's shell tools and nothing else new", () => {
  for (const host of ['claude', 'openclaude']) {
    const { matcher } = claudeHookGroups(path.join('x', 'dotclaude'), hookRunnerEntry(), null, [], host).PreToolUse[0];
    const re = new RegExp(`^(?:${matcher})$`);
    for (const name of ['Bash', 'PowerShell', 'Monitor', EXEC, BATCH, 'mcp__context-mode__ctx_batch_execute',
      'mcp__context-mode__ctx_execute_file']) {
      assert.ok(re.test(name), `${host}: ${name} is not routed by ${matcher}`);
    }
    for (const name of ['Write', 'Read', 'mcp__context-mode__ctx_search', 'mcp__context-mode__ctx_index', 'mcp__github__search_code']) {
      assert.ok(!re.test(name), `${host}: ${name} is routed by ${matcher}`);
    }
  }
});

// One command over 64 KB asks, because a gate the host's hook timeout outruns lets the call run
// unjudged. A batch is read command by command, so the bound holds for its total: two commands of
// 40 KB, each one a plain defer on its own, ask with the `unverified` text.
test('a batch past the 64 KB bound in total asks, though each command is under it', () => {
  const part = 'git -C x '.repeat(Math.ceil(40 * 1024 / 9)).slice(0, 40 * 1024);
  assert.equal(verdict(run('git-gate', { tool_name: 'Bash', tool_input: { command: part } }), 'one part'), 'defer');
  const r = run('git-gate', { tool_name: BATCH, tool_input: { commands: [part, part], queries: ['x'] } });
  assert.equal(verdict(r, 'two parts'), 'ask');
  assert.match(JSON.parse(r.out).hookSpecificOutput.permissionDecisionReason, /could not work out what it removes/);
});
