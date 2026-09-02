// `tests/test_harness.py`'s two PreToolUse gates — the git gate (Doctrine process 5 backstop)
// and the rule gate (Doctrine process 1 backstop).
//
// BOTH ARE SILENT BY DESIGN ON ALMOST EVERY PATH, which is the whole difficulty. A gate that
// never fires satisfies every "defers" assertion in this file, and a gate that fires on
// everything satisfies none of them but is equally broken; so each verb is asserted in BOTH
// directions with the same runner, and the exit code is 0 on every path either way — a hook that
// exits non-zero breaks the host's tool call rather than deferring to it.
//
// DRIVEN AS THE CHILD PROCESSES THEY REALLY ARE, with stdin from a seeded file, which is P5i's
// finding: faking a TTY or a pipe in process is where this kind of test goes wrong, and on
// Windows a redirected stdin still reads as a TTY to the reference. `tests/unit/
// excludes_guard.test.mjs` established the shape; this file needs one variant it does not have,
// because the rule gate must also be exercised with NO `--root` at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../../js/build/source.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/** `bin/geneseed-hook.mjs <verb> [--root R]` with `stdin` on fd 0. */
function hookRun(verb, { root = null, stdin = '' } = {}) {
  const sb = makeSandbox();
  try {
    const inFile = path.join(sb.path, 'stdin.json');
    fs.writeFileSync(inFile, stdin);
    const fd = fs.openSync(inFile, 'r');
    try {
      const argv = [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), verb];
      if (root !== null) argv.push('--root', root);
      const proc = spawnSync(process.execPath, argv,
        { encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'] });
      return { rc: proc.status, out: proc.stdout, err: proc.stderr };
    } finally { fs.closeSync(fd); }
  } finally { sb.cleanup(); }
}

/** The `hookSpecificOutput` of an ask decision, asserting the envelope on the way. */
function askDecision(r, what) {
  assert.equal(r.rc, 0, `${what}: a gate must never exit non-zero (${r.rc}) — that breaks the `
    + `host's tool call instead of deferring to it. stderr: ${r.err}`);
  assert.ok(r.out.trim(), `${what}: expected an ask decision, got nothing`);
  const dec = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(dec.hookEventName, 'PreToolUse');
  assert.equal(dec.permissionDecision, 'ask');
  return dec;
}

function assertDefers(r, what) {
  assert.equal(r.rc, 0, `${what}: exited ${r.rc}`);
  assert.equal(r.out, '', `${what}: expected no output (defer), got ${JSON.stringify(r.out)}`);
}

// ---------------------------------------------------------------------------------------------
// The git gate: a commit/push command — bare, flagged, chained, or `-C path` — asks.

const bashPayload = (command) =>
  JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

test('every commit and push form asks', () => {
  // The four shapes a real command arrives in. `git add . && git commit …` is the one a
  // naive "starts with git commit" check misses, and `-C /repo` is the one a "second word is
  // commit" check misses.
  for (const cmd of ['git commit -m \'x\'',
    'git push',
    'git push --force origin feature',
    'git add . && git commit -m x && git push',
    'git -C /repo push origin main']) {
    askDecision(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
  }
});

test('non-git and read-only git commands defer', () => {
  // `echo committing` is the control on the whole pattern: a gate matching the WORD rather
  // than the command would ask here, and would then ask on half the prose in a session.
  for (const cmd of ['ls -la', 'git status', 'git add .', 'echo committing']) {
    assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
  }
});

test('a well-formed ABSENCE defers silently', () => {
  // Empty stdin, an empty object, a null tool_input: nothing to evaluate. A hand-run
  // `geneseed-hook git-gate` at a terminal must not ask, or the user allow-lists the gate.
  for (const payload of ['', '{}', '{"tool_input": null}']) {
    assertDefers(hookRun('git-gate', { stdin: payload }), JSON.stringify(payload));
  }
});

// ---------------------------------------------------------------------------------------------
// FAIL CLOSED. Both gates exit 0 and signal on stdout, so a gate that crashed and a gate that
// found nothing are the same observation to the host — an allow. `guardGate` turns any throw
// into an ask that names the error. The one failure a child process can be handed from outside
// is a payload that is not JSON; the in-process cell below covers every other throw.

test('a payload that is not JSON ASKS, naming the error, on both gates', () => {
  for (const verb of ['git-gate', 'rule-gate']) {
    const dec = askDecision(hookRun(verb, { stdin: 'not json' }), `${verb} on not-json`);
    assert.match(dec.permissionDecisionReason, /gate error/);
    assert.match(dec.permissionDecisionReason, /not JSON/);
  }
});

// ---------------------------------------------------------------------------------------------
// THE GATE LEDGER. One JSON line per ask into `<root>/notebook/gates.jsonl`, carrying the rule
// and never the command: the only evidence of whether the gates fire. Nothing on a defer, so
// the common path costs nothing and the file stays a list of events, not of tool calls.

function withLedgerRoot(fn) {
  const sb = makeSandbox();
  try {
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    return fn(sb.path, path.join(sb.path, 'notebook', 'gates.jsonl'));
  } finally { sb.cleanup(); }
}

test('an ask writes one ledger line naming the rule; a defer writes nothing', () => {
  withLedgerRoot((root, ledger) => {
    assertDefers(hookRun('git-gate', { root, stdin: bashPayload('git status') }), 'status');
    assert.ok(!fs.existsSync(ledger), 'a defer must not touch the ledger');
    askDecision(hookRun('git-gate', { root, stdin: bashPayload('git push --force') }), 'force');
    askDecision(hookRun('git-gate', { root, stdin: bashPayload('git commit -m x') }), 'commit');
    askDecision(hookRun('rule-gate', { root, stdin: 'not json' }), 'not-json');
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.verb, l.rule]),
      [['git-gate', 'law-4'], ['git-gate', 'process-5'], ['rule-gate', 'gate-error']]);
    for (const l of lines) {
      assert.match(l.ts, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof l.cwd, 'string');
      // The rule, never the payload: a ledger that stored what Law I caught would be a
      // place a secret lands.
      assert.ok(!('command' in l) && !('content' in l), JSON.stringify(l));
    }
  });
});

test('a ledger that cannot be written never changes the decision', () => {
  // No notebook dir under root: the append fails with ENOENT, the ask still goes out.
  const sb = makeSandbox();
  try {
    askDecision(hookRun('git-gate', { root: sb.path, stdin: bashPayload('git push') }), 'push');
    assert.ok(!fs.existsSync(path.join(sb.path, 'notebook')), 'the hook must not mkdir');
  } finally { sb.cleanup(); }
});

test('guardGate: a throwing gate asks with the message and still exits 0', async () => {
  const { guardGate } = await import('../../js/hosts/hooks.mjs');
  const chunks = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  let rc;
  try {
    rc = guardGate(() => { throw new Error('resolvePath refused ~user'); })({ root: null });
  } finally {
    process.stdout.write = realWrite;
  }
  assert.equal(rc, 0, 'a guarded gate must never exit non-zero');
  const dec = JSON.parse(chunks.join('')).hookSpecificOutput;
  assert.equal(dec.permissionDecision, 'ask');
  assert.match(dec.permissionDecisionReason, /gate error — resolvePath refused ~user/);
});

// ---------------------------------------------------------------------------------------------
// The rule gate: a write to `user-rules.md`, to `MEMORY.md`, or to a markdown file inside THIS
// install's `memory/`, asks — so the rule-vs-memory choice reaches the user.

const writePayload = (p, key = 'file_path') =>
  JSON.stringify({ tool_name: 'Write', tool_input: { [key]: p } });

function ruleAsks(p, { root = null, key = 'file_path' } = {}) {
  const dec = askDecision(hookRun('rule-gate', { root, stdin: writePayload(p, key) }), p);
  // THE MESSAGE IS THE FEATURE. An `ask` with no reason is a permission prompt the user
  // cannot answer: it must name the rule and route to the skill that resolves it.
  assert.ok(dec.permissionDecisionReason.includes('Doctrine process 1'), dec.permissionDecisionReason);
  assert.ok(dec.permissionDecisionReason.includes('rule skill'), dec.permissionDecisionReason);
}

const ruleDefers = (p, root = null) =>
  assertDefers(hookRun('rule-gate', { root, stdin: writePayload(p) }), p);

test('the two coined store names ask anywhere', () => {
  // Both names are Geneseed's own coinage, so they need no install context to be recognised.
  for (const p of ['C:\\Users\\me\\.claude\\user-rules.md',
    '/home/me/proj/.bob/user-rules.md',
    'C:\\Users\\me\\.claude\\memory\\MEMORY.md']) {
    ruleAsks(p);
  }
});

test('a markdown file under THIS install\'s memory/ asks', () => {
  const sb = makeSandbox();
  try {
    const root = sb.path;
    fs.mkdirSync(path.join(root, 'memory', 'agents'), { recursive: true });
    ruleAsks(path.join(root, 'memory', 'pnpm-preferred.md'), { root });
    ruleAsks(path.join(root, 'memory', 'agents', 'reviewer.md'), { root });
  } finally { sb.cleanup(); }
});

test('ordinary work defers', () => {
  const sb = makeSandbox();
  try {
    const root = sb.path;
    fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
    // A PROJECT'S OWN memory/ FOLDER IS NOT THIS INSTALL'S. Plenty of repositories have one,
    // and a gate that asked on all of them would be a prompt on somebody else's source file.
    ruleDefers(path.join(root, 'src', 'memory', 'notes.md'), root);
    // Not markdown.
    ruleDefers(path.join(root, 'memory', 'scratch.txt'), root);
    // The notebook is not the memory store.
    ruleDefers(path.join(root, 'notebook', 'draft.md'), root);
  } finally { sb.cleanup(); }
  ruleDefers('src/app.py');
  ruleDefers('docs/rules.md');
});

test('the memory match needs a root, and the coined names still do not', () => {
  // Without `--root` there is no install to scope `memory/` to, so an unrooted gate can never
  // over-reach — but the two coined names are still recognised, which is what keeps the
  // unrooted gate useful rather than inert.
  ruleDefers('/home/me/.claude/memory/fact.md');
  ruleAsks('/home/me/.claude/user-rules.md');
});

test('the alternate path key is read, and a well-formed but empty path defers', () => {
  // `not json` moved out of this row: an unreadable payload now ASKS (see the fail-closed
  // cells above). An empty or non-string path is a well-formed absence and still defers.
  ruleAsks('/home/me/.claude/user-rules.md', { key: 'path' });
  for (const bad of [writePayload(''), writePayload(42)]) {
    assertDefers(hookRun('rule-gate', { stdin: bad }), JSON.stringify(bad).slice(0, 60));
  }
});

// ---------------------------------------------------------------------------------------------
// Law IV at the boundary: a history-destroying git verb asks even when no commit/push is
// present. `git checkout -- <path>` is included because it reverts to the INDEX and eats
// unstaged work — the mistake this repo's own memory records. `push --force` trips this gate
// rather than process 5's, because the stronger reason is the one the user should read.

test('a destructive git verb asks under Law IV', () => {
  for (const cmd of ['git reset --hard HEAD~1',
    'git clean -fd',
    'git branch -D feature',
    'git checkout -- src/',
    'git push --force-with-lease',
    'cd /repo && git reset --hard origin/main']) {
    const dec = askDecision(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
    assert.ok(dec.permissionDecisionReason.includes('Law IV'), dec.permissionDecisionReason);
  }
});

test('a soft reset, a -d branch delete, a plain checkout and a dry-run clean defer', () => {
  for (const cmd of ['git reset --soft HEAD~1', 'git branch -d merged', 'git checkout main',
    'git clean -n']) {
    assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
  }
});

// ---------------------------------------------------------------------------------------------
// Law I at the boundary: a Write/Edit whose content carries a high-precision credential shape
// asks, unless the target is a dotenv file — the one place Law I says a secret may live. The
// shapes are vendor prefixes, not entropy heuristics, so a hash or a lockfile never trips it.

const contentPayload = (file_path, content, key = 'content') =>
  JSON.stringify({ tool_name: 'Write', tool_input: { file_path, [key]: content } });

test('a credential-shaped write asks under Law I', () => {
  const shapes = ['AKIAIOSFODNN7EXAMPLE',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'xoxb-1234567890-abcdefghij',
    '-----BEGIN RSA PRIVATE KEY-----'];
  for (const s of shapes) {
    const dec = askDecision(hookRun('rule-gate',
      { stdin: contentPayload('src/config.js', `const k = "${s}";`) }), s);
    assert.ok(dec.permissionDecisionReason.includes('Law I'), dec.permissionDecisionReason);
  }
  // Edit sends `new_string`, not `content`.
  askDecision(hookRun('rule-gate',
    { stdin: contentPayload('src/a.py', 'AKIAIOSFODNN7EXAMPLE', 'new_string') }), 'new_string');
});

test('a dotenv target and ordinary content defer', () => {
  assertDefers(hookRun('rule-gate',
    { stdin: contentPayload('.env', 'AWS_KEY=AKIAIOSFODNN7EXAMPLE') }), '.env');
  assertDefers(hookRun('rule-gate',
    { stdin: contentPayload('/p/.env.local', 'GH=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345') }),
  '.env.local');
  assertDefers(hookRun('rule-gate',
    { stdin: contentPayload('src/a.js', 'const sk = "skeleton-key";') }), 'ordinary');
});
