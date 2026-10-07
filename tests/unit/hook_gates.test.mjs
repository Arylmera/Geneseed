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
function hookRun(verb, { root = null, stdin = '', host = null, extra = [], cwd = null } = {}) {
  const sb = makeSandbox();
  try {
    const inFile = path.join(sb.path, 'stdin.json');
    fs.writeFileSync(inFile, stdin);
    const fd = fs.openSync(inFile, 'r');
    try {
      const argv = [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), verb];
      if (root !== null) argv.push('--root', root);
      if (host !== null) argv.push('--host', host);
      argv.push(...extra);
      const proc = spawnSync(process.execPath, argv, {
        encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'], ...(cwd ? { cwd } : {}),
      });
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

// The cap. 1000 lines is the ceiling; the 1001st ask drops the OLDEST line, never the newest,
// so `status` keeps counting the asks that still describe how this install is being used.
test('the ledger keeps the newest 1000 lines and drops the oldest on the next ask', () => {
  withLedgerRoot((root, ledger) => {
    const seed = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ ts: 't', verb: 'seed', rule: `r${i}`, cwd: '.' }));
    fs.writeFileSync(ledger, `${seed.join('\n')}\n`);
    askDecision(hookRun('git-gate', { root, stdin: bashPayload('git push') }), 'push');
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1000);
    assert.equal(lines[0].rule, 'r1', 'the oldest line is the one that goes');
    assert.equal(lines.at(-1).rule, 'process-5', 'the newest ask survives the trim');
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

// The ask document is a hand-written template since json.mjs left the gate path, so it must stay
// BYTE-identical to the general serializer it replaced — Python's `json.dumps` spelling, whose
// `ensure_ascii` writes every code unit past `~` as lowercase `\uXXXX` (an astral character as its
// two surrogate halves), and `\n`/`\t`/`"`/`\` in their short escapes. Every gate reason carries
// an em dash, so the non-ASCII rows are the ones that ship.
test('askDecision is byte-identical to the compact json.dumps it replaced', async () => {
  const { askDecision: render } = await import('../../js/hosts/hooks.mjs');
  const { jsonDumpsCompact } = await import('../../js/lib/json.mjs');
  for (const reason of ['plain', 'Geneseed (Consent Before Push) — every git commit',
    'café à l’école', 'astral \u{1F600} pair', 'quote " slash \\ nl \n tab \t',
    'ctl \u0001 del \u007f', '']) {
    assert.equal(render(reason), `${jsonDumpsCompact({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason,
      },
    })}\n`, JSON.stringify(reason));
  }
  assert.ok(render('a — b').includes('a \\u2014 b'), 'the em dash must leave as \\u2014');
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
  assert.ok(dec.permissionDecisionReason.includes('Persist Insight'), dec.permissionDecisionReason);
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

test('a destructive git verb asks under Deletion Is Deliberate', () => {
  for (const cmd of ['git reset --hard HEAD~1',
    'git clean -fd',
    'git branch -D feature',
    'git checkout -- src/',
    'git push --force-with-lease',
    'cd /repo && git reset --hard origin/main',
    // The flag need not follow the verb, and a `+refspec` is a force push with no flag at all.
    // Each of these slipped past when the regex wanted `--hard`/`-f`/`--force` right after it.
    'git push -f origin main',
    'git push origin -f',
    'git push origin +main',
    'git reset -q --hard',
    'git clean -d -f',
    'git clean -d -xf']) {
    const dec = askDecision(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
    assert.ok(dec.permissionDecisionReason.includes('Deletion Is Deliberate'), dec.permissionDecisionReason);
  }
});

test('an ordinary push is not a force push, so with consent off it defers', () => {
  // `--no-consent` takes process 5 out, so only Law IV could ask: a `-u`, a `--follow-tags`
  // (an `f` after `--`, not a `-f` cluster) and a plain refspec are not destructive.
  for (const cmd of ['git push', 'git push origin main', 'git push -u origin feature',
    'git push --follow-tags', 'git push origin HEAD:main']) {
    assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd), extra: ['--no-consent'] }), cmd);
  }
});

test('a soft reset, a -d branch delete, a plain checkout and a dry-run clean defer', () => {
  for (const cmd of ['git reset --soft HEAD~1', 'git branch -d merged', 'git checkout main',
    'git clean -n', 'git clean -n -d', 'git reset --soft HEAD -q']) {
    assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
  }
});

// ---------------------------------------------------------------------------------------------
// Law I at the boundary: a Write/Edit whose content carries a high-precision credential shape
// asks, unless the target is a dotenv file — the one place Law I says a secret may live. The
// shapes are vendor prefixes, not entropy heuristics, so a hash or a lockfile never trips it.

const contentPayload = (file_path, content, key = 'content') =>
  JSON.stringify({ tool_name: 'Write', tool_input: { file_path, [key]: content } });

test('a credential-shaped write asks under Sealed Secrets', () => {
  const shapes = ['AKIAIOSFODNN7EXAMPLE',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    // base64url: an `_` inside the first 20 characters once cut the match short.
    'sk-ant-api03-abcdefghij_klmnopqrstuvwxyz-0123',
    'xoxb-1234567890-abcdefghij',
    '-----BEGIN RSA PRIVATE KEY-----'];
  for (const s of shapes) {
    const dec = askDecision(hookRun('rule-gate',
      { stdin: contentPayload('src/config.js', `const k = "${s}";`) }), s);
    assert.ok(dec.permissionDecisionReason.includes('Sealed Secrets'), dec.permissionDecisionReason);
  }
  // Edit sends `new_string`, not `content`.
  askDecision(hookRun('rule-gate',
    { stdin: contentPayload('src/a.py', 'AKIAIOSFODNN7EXAMPLE', 'new_string') }), 'new_string');
});

test('MultiEdit and NotebookEdit carrying a credential ask too', () => {
  // The settings matcher routes both here. MultiEdit puts its text in `edits[].new_string` —
  // the secret sits in the SECOND edit, so a gate reading only the first still misses it — and
  // NotebookEdit names its file `notebook_path` and its text `new_source`.
  const multi = JSON.stringify({ tool_name: 'MultiEdit', tool_input: { file_path: 'src/a.js',
    edits: [{ old_string: 'a', new_string: 'b' },
      { old_string: 'c', new_string: 'const k = "AKIAIOSFODNN7EXAMPLE";' }] } });
  const note = JSON.stringify({ tool_name: 'NotebookEdit', tool_input: {
    notebook_path: 'nb/a.ipynb', cell_id: 'x', new_source: 'key = "AKIAIOSFODNN7EXAMPLE"' } });
  for (const [what, stdin] of [['MultiEdit', multi], ['NotebookEdit', note]]) {
    const dec = askDecision(hookRun('rule-gate', { stdin }), what);
    assert.ok(dec.permissionDecisionReason.includes('Sealed Secrets'), dec.permissionDecisionReason);
  }
  // The control: the same shapes with clean text defer.
  assertDefers(hookRun('rule-gate', { stdin: multi.replace('AKIAIOSFODNN7EXAMPLE', 'x') }),
    'clean MultiEdit');
  assertDefers(hookRun('rule-gate', { stdin: note.replace('AKIAIOSFODNN7EXAMPLE', 'x') }),
    'clean NotebookEdit');
});

// ---------------------------------------------------------------------------------------------
// `--no-consent`: the git gate an install with process 5 OFF is wired with. The consent ask has
// no rule behind it there, so a commit defers — but Law IV is universal and still asks.

test('git-gate --no-consent skips only the process-5 ask; Law IV still asks', () => {
  const opts = (command) => ({ stdin: bashPayload(command), extra: ['--no-consent'] });
  assertDefers(hookRun('git-gate', opts('git commit -m x')), 'commit');
  assertDefers(hookRun('git-gate', opts('git push origin main')), 'push');
  const law4 = askDecision(hookRun('git-gate', opts('git reset --hard HEAD~1')), 'reset --hard');
  assert.match(law4.permissionDecisionReason, /Deletion Is Deliberate/);
});

// ---------------------------------------------------------------------------------------------
// THE BOB DIALECT. Bob's PreToolUse ignores stdout and refuses only on EXIT CODE 2 — the one
// place in this file where a gate exits non-zero on purpose. Laws I and IV exit 2 with the
// reason on stderr; the consent rules are a stderr line with exit 0 (no ask tier); stdout stays
// EMPTY on every path, because Bob would not read it. Same payload field names as Claude.

test('bob: Laws I and IV exit 2 with the reason on stderr; consent rules warn and exit 0', () => {
  for (const [verb, stdin, what] of [
    ['tool-gate', bashPayload('git reset --hard'), 'Deletion Is Deliberate'],
    ['tool-gate', contentPayload('src/a.js', 'AKIAIOSFODNN7EXAMPLE'), 'Sealed Secrets'],
    ['git-gate', bashPayload('git push --force'), 'Deletion Is Deliberate']]) {
    const r = hookRun(verb, { stdin, host: 'bob' });
    assert.equal(r.rc, 2, `${what}: expected exit 2, got ${r.rc}`);
    assert.equal(r.out, '', `${what}: Bob ignores stdout, nothing should be there: ${r.out}`);
    assert.match(r.err, /BLOCKED: Geneseed/);
    assert.ok(r.err.includes(what), r.err);
  }
  const commit = hookRun('tool-gate', { stdin: bashPayload('git commit -m x'), host: 'bob' });
  assertDefers(commit, 'commit');
  assert.match(commit.err, /Consent Before Push/);
  // The ask also points at the visual walkthrough, so a reviewer can see the change first.
  assert.match(commit.err, /explain-changes/);
  assertDefers(hookRun('tool-gate', { stdin: bashPayload('git status'), host: 'bob' }), 'status');
});

test('bob: a deny is ledgered, a warning is not', () => {
  withLedgerRoot((root, ledger) => {
    hookRun('tool-gate', { root, host: 'bob', stdin: bashPayload('git commit -m x') });
    assert.ok(!fs.existsSync(ledger));
    hookRun('tool-gate', { root, host: 'bob', stdin: bashPayload('git push --force') });
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.rule), ['law-4']);
  });
});

test('the Claude dialect is unchanged when --host is absent, and tool-gate speaks it too', () => {
  askDecision(hookRun('tool-gate', { stdin: bashPayload('git push') }), 'tool-gate/claude');
  askDecision(hookRun('tool-gate',
    { stdin: contentPayload('src/a.js', 'AKIAIOSFODNN7EXAMPLE') }), 'tool-gate/claude/secret');
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

// ---------------------------------------------------------------------------------------------
// Consent Before Push's loop/* exemption is a WHITELIST, not a blacklist: it holds only for a
// fixed set of command forms, on a branch a loop was actually LAUNCHED on (LOOP.md's state
// marker — not just a name starting with `loop/`, which anyone can type). The gate learns the
// branch from .git/HEAD — through a worktree's .git FILE too — and never spawns git.

const LOOP_MARKER = '<!-- loop-state:begin -->\n{}\n<!-- loop-state:end -->\n';

/**
 * A sandboxed repo on `branch`, as a plain repo or a worktree, with `cwd` inside it.
 * `loop`: `'valid'` writes a LOOP.md carrying the state marker at the git root, `'invalid'`
 * writes one without it, `'none'` (default) writes no LOOP.md at all.
 */
function repoOn(branch, { worktree = false, loop = 'none' } = {}) {
  const sb = makeSandbox();
  const root = sb.path;
  let gitRoot;
  let cwd;
  if (worktree) {
    const gitdir = path.join(root, 'main-repo', '.git', 'worktrees', 'w');
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, 'HEAD'), `ref: refs/heads/${branch}\n`);
    fs.mkdirSync(path.join(root, 'w'));
    fs.writeFileSync(path.join(root, 'w', '.git'), `gitdir: ${gitdir}\n`);
    gitRoot = path.join(root, 'w');
    cwd = gitRoot;
  } else {
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
    fs.mkdirSync(path.join(root, 'sub'));
    gitRoot = root;
    cwd = path.join(root, 'sub');
  }
  if (loop === 'valid') fs.writeFileSync(path.join(gitRoot, 'LOOP.md'), LOOP_MARKER);
  if (loop === 'invalid') fs.writeFileSync(path.join(gitRoot, 'LOOP.md'), '# a loop file with no state block\n');
  return { cleanup: sb.cleanup, cwd, gitRoot };
}

test('on a loop/* branch with a launched loop, the whitelisted commit/push forms defer — plain repo and worktree', () => {
  for (const worktree of [false, true]) {
    const { cleanup, cwd } = repoOn('loop/x', { worktree, loop: 'valid' });
    try {
      for (const cmd of [
        // The ONLY exempt push form: an explicit, colon-qualified HEAD:<branch> refspec.
        'git push -u origin HEAD:loop/x',
        'git push origin HEAD:refs/heads/loop/x',
        'git add -A && git commit -F .git/LOOP_COMMIT_MSG && git push -u origin HEAD:loop/x',
        'git status && git commit -F msg.txt',
        // A Windows absolute path (drive letter) through the `-F` path token.
        'git commit -F C:/Users/x/repo/.git/LOOP_COMMIT_MSG',
      ]) {
        assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd), cwd }), cmd);
      }
    } finally { cleanup(); }
  }
});

test('every escape the review found still asks, on that same loop/launched branch', () => {
  const { cleanup, cwd } = repoOn('loop/x', { loop: 'valid' });
  try {
    for (const cmd of [
      // Moved to ASK in fix round 2 (X2): none of these names an explicit HEAD:<branch>
      // refspec, so every one of them is redirectable by push.default/remote.*.push.
      'git push',
      'git push origin',
      'git push -u origin',
      'git push origin HEAD',
      'git push origin loop/x',
      'git push origin "HEAD:main"',
      "git push origin 'main'",
      'git push origin HEAD:main>/dev/null',
      'git push origin HEAD:main)',
      'cd ../other && git push',
      'git -C ../other push',
      'git switch - && git commit -F m',
      'GIT_DIR=x git push',
      'git push --all',
      'git push --mirror',
      'git -c push.default=matching push',
      'git push --tags',
      'git push origin v9.9.9',
      'git push -f origin loop/x',
      'git push origin +loop/x',
      'git push origin :feature/x',
      'git push origin --delete feature/x',
      'git commit -m "x"',
      'git commit --amend -F m',
      'git commit -F m\necho hi',
      // Re-review fold-in: the loose `[^\s'"]+` path class let brace/glob expansion turn
      // the loop's own commit into something else entirely.
      'git commit -F {m,--amend} && git push -u origin HEAD:loop/x',
      'git commit -F m* && git push -u origin HEAD:loop/x',
      // X1: a single `&` (not doubled into `&&`) still chains two commands for a shell —
      // the splitter used to only recognise the doubled form.
      'git add -A & git push origin HEAD:main',
      'git status & git push --mirror',
      'git log & git push origin :main',
      'git add -A & cd ../o & git push',
      // X1: brace/glob expansion can turn one whitelisted-looking token into several
      // unknown ones, so neither is in the tightened argument token class. (A bare `git add`
      // never reaches this gate at all — it names neither commit nor push — so each is
      // chained with a push/commit to actually exercise the whitelist.)
      'git add {a,b} && git commit -F m',
      'git add * && git push -u origin HEAD:loop/x',
    ]) {
      askDecision(hookRun('git-gate', { stdin: bashPayload(cmd), cwd }), cmd);
    }
  } finally { cleanup(); }
});

test('LOOP.md as a symlink is not launched evidence — asks', (t) => {
  const { cleanup, cwd, gitRoot } = repoOn('loop/x', { loop: 'none' });
  try {
    const target = path.join(gitRoot, 'REAL_LOOP.md');
    fs.writeFileSync(target, LOOP_MARKER);
    try {
      fs.symlinkSync(target, path.join(gitRoot, 'LOOP.md'));
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EPERM') { t.skip('symlinks need privileges here'); return; }
      throw e;
    }
    askDecision(hookRun('git-gate',
      { stdin: bashPayload('git push -u origin HEAD:loop/x'), cwd }), 'symlink LOOP.md');
  } finally { cleanup(); }
});

test('also asks: no LOOP.md, a LOOP.md without the state marker, or a shared branch with a valid one', () => {
  // Each row's command is otherwise the one exempt shape — an explicit HEAD:<branch> refspec
  // for that row's own branch — so the ask proves the LOOP.md/branch check, not the shape.
  for (const [branch, loop, cmd] of [
    ['loop/x', 'none', 'git push -u origin HEAD:loop/x'],
    ['loop/x', 'invalid', 'git push -u origin HEAD:loop/x'],
    ['main', 'valid', 'git push -u origin HEAD:main'],
  ]) {
    const { cleanup, cwd } = repoOn(branch, { loop });
    try { askDecision(hookRun('git-gate', { stdin: bashPayload(cmd), cwd }), `${branch}/${loop}`); }
    finally { cleanup(); }
  }
});

// ---------------------------------------------------------------------------------------------
// The sensor gate (External Gate): a project lists the checks its agent must not edit in
// `.geneseed/protected-checks.txt`, one repo-relative path per line. A write at or under one
// asks on Claude and blocks on Bob; everything else defers. The file is found by walking up
// from the TARGET to the first `.git`, so a file above the repo protects nothing.

function sensorRepo(sb, lines) {
  const repo = path.join(sb.path, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.geneseed'));
  fs.writeFileSync(path.join(repo, '.geneseed', 'protected-checks.txt'), lines);
  return repo;
}

test('a write under a protected check asks under External Gate; a near miss defers', () => {
  const sb = makeSandbox();
  try {
    const repo = sensorRepo(sb, '# checks the agent may not edit\r\ntests/\nci/verify.sh\n\n');
    for (const p of [path.join(repo, 'tests', 'a.test.js'), path.join(repo, 'tests', 'deep', 'b.js'),
      path.join(repo, 'ci', 'verify.sh')]) {
      const dec = askDecision(hookRun('rule-gate', { stdin: writePayload(p) }), p);
      assert.ok(dec.permissionDecisionReason.includes('External Gate'), dec.permissionDecisionReason);
      assert.ok(dec.permissionDecisionReason.includes('protected-checks.txt'), dec.permissionDecisionReason);
    }
    for (const p of [path.join(repo, 'src', 'a.js'), path.join(repo, 'ci', 'verify.sh.bak'),
      path.join(repo, 'testsuite', 'x.js'), path.join(repo, '.geneseed', 'other.md')]) ruleDefers(p);
  } finally { sb.cleanup(); }
});

test('the list itself is protected, and Bob blocks rather than asks', () => {
  const sb = makeSandbox();
  try {
    const repo = sensorRepo(sb, 'tests/\n');
    const list = path.join(repo, '.geneseed', 'protected-checks.txt');
    askDecision(hookRun('rule-gate', { stdin: writePayload(list) }), list);
    const r = hookRun('tool-gate', { stdin: writePayload(path.join(repo, 'tests', 'a.js')), host: 'bob' });
    assert.equal(r.rc, 2, `bob: expected exit 2, got ${r.rc}`);
  } finally { sb.cleanup(); }
});

test('no list in the repo protects nothing, even with one above the repo', () => {
  const sb = makeSandbox();
  try {
    fs.mkdirSync(path.join(sb.path, '.geneseed'));
    fs.writeFileSync(path.join(sb.path, '.geneseed', 'protected-checks.txt'), 'repo/tests/\n');
    const repo = path.join(sb.path, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    ruleDefers(path.join(repo, 'tests', 'a.js'));
  } finally { sb.cleanup(); }
});
