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
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

/** `bin/geneseed-hook.mjs <verb> [--root R]` with `stdin` on fd 0. */
function hookRun(verb, { root = null, stdin = '', host = null, extra = [], cwd = null, env = null } = {}) {
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
        ...(env ? { env } : {}),
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

// A manifest that records the three stand-down verbs as wired, plus the `settings.json` that
// carries them, the way a live emit leaves both: the stand-down needs `managed.settings_hooks` to
// name the verb AND the settings file to still run it, not just a manifest (final review C1).
const WIRED_GROUPS = ['context', 'git-gate', 'learn']
  .map((verb) => ({ event: 'X', group: { hooks: [{ type: 'command', command: `hook ${verb} --root r` }] } }));
const WIRED_MANIFEST = JSON.stringify({ managed: { settings_hooks: WIRED_GROUPS } });
const WIRED_SETTINGS = JSON.stringify({ hooks: { X: WIRED_GROUPS.map((r) => r.group) } });

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

// B5 confirmed-live gaps (claude-code.md / claude-verdict.md): the long/modern spellings of
// the same Law IV acts above — all inside "deletion of what version control cannot restore".
// `restore`/`switch`/`checkout -f` discard uncommitted work the same way `checkout -- ` does;
// `stash drop/clear` deletes stashed work; `worktree remove --force` can discard an uncommitted
// worktree; `reflog expire` and `gc --prune=now` delete the safety net reflog/dangling commits
// provide; `push :branch`/`push --delete` deletes a remote branch, the same act `--force` push
// trips this gate for rather than process 5's.
test('the B5 long/modern-spelling gaps ask under Deletion Is Deliberate too', () => {
  for (const cmd of [
    'git clean --force',
    'git branch --delete --force x',
    'git branch --force --delete x',
    'git restore .',
    'git restore src/file.js',
    'git -C /repo restore .',
    'cd /repo && git restore .',
    // `--staged --worktree` together restores BOTH the index and the working tree, so it
    // discards exactly like plain `restore` — unlike `--staged` alone (see the negative below).
    'git restore --staged --worktree x',
    'git push origin :main',
    'git push --delete origin x',
    'git checkout -f',
    'git checkout --force',
    'git switch -f other',
    // git switch -h lists these as two SEPARATE options, not one flag's long and short spelling.
    'git switch --force',
    'git switch --discard-changes',
    'git stash drop',
    'git stash clear',
    'git worktree remove --force ../wt',
    'git reflog expire --expire=now',
    'git gc --prune=now']) {
    const dec = askDecision(hookRun('git-gate', { stdin: bashPayload(cmd) }), cmd);
    assert.ok(dec.permissionDecisionReason.includes('Deletion Is Deliberate'), dec.permissionDecisionReason);
  }
});

// Negatives named in the brief: `git restore --staged` ALONE only unstages — version control
// still holds the staged change, nothing is discarded, so Law IV does not reach it (contrast the
// `--staged --worktree` row above, which does discard). An un-forced `git branch --delete`
// refuses unless the branch is merged, same as `-d`, so it defers like the existing `-d` row
// below. And because `restore`/`stash drop`/`stash clear` have no required flag or use ordinary
// English words, they are matched only in VERB POSITION (right after `git`, or `git -C <path>`)
// — a commit message or a filename that merely contains the word must never trip Law IV.
test('restore --staged, an un-forced branch --delete, and "restore"/"drop"/"clear" as plain '
  + 'text (not a verb) all defer under Law IV', () => {
  for (const cmd of [
    'git restore --staged x',
    'git restore --staged .',
    'git branch --delete merged',
    'git add src/restore.js',
    'git checkout restore-ui-fix',
    'git commit -m "restore working behavior"',
    'git stash push -m "clear old state"',
    'git commit -m "drop the old flag"']) {
    assertDefers(hookRun('git-gate', { stdin: bashPayload(cmd), extra: ['--no-consent'] }), cmd);
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
  // The settings matcher routes only NotebookEdit here now — MultiEdit is not a Claude Code
  // tool (absent from tools-reference.md) and was dropped from the matcher (Claude verdict
  // R2). The `edits[]` scan survives anyway as a cheap guard against a tool-table surprise or
  // a future re-add, costing nothing on payloads that never carry it. MultiEdit puts its text
  // in `edits[].new_string` — the secret sits in the SECOND edit, so a gate reading only the
  // first still misses it — and NotebookEdit names its file `notebook_path` and its text
  // `new_source`.
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
// GLOBAL BESIDE PROJECT (host-compat Claude B4). Claude runs EVERY matching hook and the
// strictest verdict wins, so when a global and a project install of the same host coexist, the
// global git-gate used to ask process 5 on every commit even though the project was built with
// `--no-consent`, and `learn` ran twice per Stop. Both now stand down exactly as `context` does:
// the project's own hook decides, and `GENESEED_STACK_GLOBAL` stacks the global on purpose.

/** A sandbox with a global install (folder `globalName`) and a repo carrying a project one. */
function globalBesideProject(globalName, marker, fn) {
  const sb = makeSandbox();
  try {
    const mk = (d) => {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, '.geneseed-manifest.json'), WIRED_MANIFEST);
      fs.writeFileSync(path.join(d, 'settings.json'), WIRED_SETTINGS);
      return d;
    };
    const gcfg = mk(path.join(sb.path, 'home', globalName));
    // Every real global carries its emit marker; a relocated one with no `--host` is keyed on it.
    fs.writeFileSync(path.join(gcfg, '.geneseed-emit'), `${marker.slice(1)}-global\n`);
    const repo = path.join(sb.path, 'repo');
    const pcfg = mk(path.join(repo, marker));
    const env = { ...process.env };
    for (const k of ['GENESEED_STACK_GLOBAL', 'GENESEED_ROOT', 'GENESEED_LLM', 'CLAUDE_PROJECT_DIR']) delete env[k];
    return fn({ gcfg, pcfg, repo, env });
  } finally { sb.cleanup(); }
}

test('a global git-gate stands down for a project install; the project gate still decides', () => {
  // Rows: [global folder, --host, project marker]. The relocated folders are the B9/I2 case:
  // the marker comes from --host (or, with none, the root's `.geneseed-emit`), not the folder name.
  for (const [folder, host, marker] of [['.claude', null, '.claude'],
    ['claude-work', null, '.claude'], ['oc-cfg', 'openclaude', '.openclaude']]) {
    globalBesideProject(folder, marker, ({ gcfg, pcfg, repo, env }) => {
      const run = (root, command, extra = [], e = env) => hookRun('git-gate',
        { root, host, stdin: bashPayload(command), cwd: repo, env: e, extra });
      // The global is silent even on Law IV: the project's own gate is about to judge it.
      assertDefers(run(gcfg, 'git commit -m x'), `${folder}: global gate on a commit`);
      assertDefers(run(gcfg, 'git reset --hard HEAD~1'), `${folder}: global gate on reset --hard`);
      // The project built with --no-consent: its commit passes, its Law IV still asks.
      assertDefers(run(pcfg, 'git commit -m x', ['--no-consent']), `${folder}: project --no-consent`);
      askDecision(run(pcfg, 'git reset --hard HEAD~1', ['--no-consent']), `${folder}: project law-4`);
      // The opt-out un-silences the global.
      askDecision(run(gcfg, 'git commit -m x', [], { ...env, GENESEED_STACK_GLOBAL: '1' }),
        `${folder}: GENESEED_STACK_GLOBAL`);
    });
  }
});

test('a global learn stands down for a project install; the project learn still runs', () => {
  // With `$GENESEED_LLM` unset, `learn` prints its prompt to stdout — the observable "it ran".
  // Its install root is the parent of `--memory`, the same root its sovereign bypass reads.
  for (const [folder, host, marker] of [['.claude', null, '.claude'],
    ['claude-work', null, '.claude'], ['bob-cfg', 'bob', '.bob']]) {
    globalBesideProject(folder, marker, ({ gcfg, pcfg, repo, env }) => {
      const run = (cfg, e = env) => hookRun('learn', {
        host, stdin: 'a durable fact worth keeping', cwd: repo, env: e,
        extra: ['--memory', path.join(cfg, 'memory')] });
      const global = run(gcfg);
      assert.equal(global.rc, 0, `${folder}: ${global.err}`);
      assert.equal(global.out, '', `${folder}: the global learn ran beside a project install`);
      assert.match(run(pcfg).out, /NOTES:/, `${folder}: the project learn did not run`);
      assert.match(run(gcfg, { ...env, GENESEED_STACK_GLOBAL: '1' }).out, /NOTES:/,
        `${folder}: GENESEED_STACK_GLOBAL did not un-silence the global learn`);
    });
  }
});

test('a gate stays loud unless a project gate replaces it: other globals, cd elsewhere', () => {
  // THE BINDING RULE: a global gate goes quiet ONLY where an equivalent project gate fires.
  // Two ways the first cut broke it, each a written-out row driven through the real entry point:
  //   * another GLOBAL in the project dir (`CLAUDE_CONFIG_DIR=~/.claude-work`, a session started
  //     in `~`, where `~/.claude` is still there with or without its emit marker) is not a
  //     project install — nothing replaces the relocated global's gate, so `git push --force`
  //     must still ask;
  //   * the agent `cd`s from project A into repo B: B's project install was never loaded (Claude
  //     loads project hooks from `$CLAUDE_PROJECT_DIR`, the session's root), so the gate keys on
  //     `$CLAUDE_PROJECT_DIR` when set, not on the hook's cwd.
  const sb = makeSandbox();
  try {
    const home = path.join(sb.path, 'home');
    const mk = (d, emit) => {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, '.geneseed-manifest.json'), WIRED_MANIFEST);
      fs.writeFileSync(path.join(d, 'settings.json'), WIRED_SETTINGS);
      if (emit) fs.writeFileSync(path.join(d, '.geneseed-emit'), `${emit}\n`);
      return d;
    };
    const work = mk(path.join(home, '.claude-work'), 'claude-global');
    const dotClaude = mk(path.join(home, '.claude'), 'claude-global');
    const repoA = path.join(home, 'src', 'a');
    fs.mkdirSync(repoA, { recursive: true });
    const repoB = path.join(home, 'src', 'b');
    mk(path.join(repoB, '.claude'));
    const env = { ...process.env, ...homeOverrides(home), CLAUDE_CONFIG_DIR: work };
    for (const k of ['GENESEED_STACK_GLOBAL', 'GENESEED_ROOT', 'GENESEED_LLM', 'CLAUDE_PROJECT_DIR']) delete env[k];
    const force = (cwd, e = env) => hookRun('git-gate',
      { root: work, stdin: bashPayload('git push --force'), cwd, env: e });

    askDecision(force(home), 'another global ~/.claude (with emit marker) silenced the gate');
    askDecision(force(repoA, { ...env, CLAUDE_PROJECT_DIR: home }),
      'another global ~/.claude as $CLAUDE_PROJECT_DIR/.claude silenced the gate');
    fs.rmSync(path.join(dotClaude, '.geneseed-emit'));
    askDecision(force(home), 'a leftover ~/.claude (no emit marker) silenced the gate');
    // cwd = B (has a project install), session project = A (has none): the gate still asks.
    askDecision(force(repoB, { ...env, CLAUDE_PROJECT_DIR: repoA }),
      'a cd into a repo whose hooks were never loaded silenced the gate');
    // And learn follows the same project dir.
    const learnB = hookRun('learn', { stdin: 'a durable fact', cwd: repoB,
      env: { ...env, CLAUDE_PROJECT_DIR: repoA }, extra: ['--memory', path.join(work, 'memory')] });
    assert.match(learnB.out, /NOTES:/, 'a cd into another repo silenced the global learn');
    // Control: the session's own project IS B — the project gate fires, the global stands down.
    assertDefers(force(repoB, { ...env, CLAUDE_PROJECT_DIR: repoB }), 'global beside project B');
  } finally { sb.cleanup(); }
});

test('only the session\'s own project dir silences: no walk up, for any host', () => {
  // ROUND 3 (Task 11 review). Claude reads a project's `.claude/settings.json` from the session's
  // primary working directory, not its ancestors (`settings.md`, "reads the shared
  // `.claude/settings.json` from the session's primary working directory"). So a project install
  // ABOVE the project dir proves nothing about which project gate fired, and the stand-down
  // tests `<project dir>/<marker>` alone. Bob's project-hook lookup is undocumented, so its
  // cwd fallback does not walk either: a doubled ask is safe, a silenced gate is not.
  // Rows: [label, CLAUDE_PROJECT_DIR (null = unset), cwd, expected].
  const sb = makeSandbox();
  try {
    const home = path.join(sb.path, 'home');
    const mk = (d, emit) => {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, '.geneseed-manifest.json'), WIRED_MANIFEST);
      fs.writeFileSync(path.join(d, 'settings.json'), WIRED_SETTINGS);
      if (emit) fs.writeFileSync(path.join(d, '.geneseed-emit'), `${emit}\n`);
      return d;
    };
    const dir = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
    const work = mk(path.join(home, '.claude-work'), 'claude-global');
    const mono = dir(path.join(home, 'mono'));
    mk(path.join(mono, '.claude'));
    const pkg = dir(path.join(mono, 'pkg'));
    mk(path.join(pkg, '.claude'));
    const sub = dir(path.join(pkg, 'sub'));
    const mono2 = dir(path.join(home, 'mono2'));
    mk(path.join(mono2, '.claude'));
    const pkg2 = dir(path.join(mono2, 'pkg'));
    const hand = dir(path.join(home, 'hand'));
    mk(path.join(hand, '.claude'), 'claude-global');
    const env = { ...process.env, ...homeOverrides(home), CLAUDE_CONFIG_DIR: work };
    for (const k of ['GENESEED_STACK_GLOBAL', 'GENESEED_ROOT', 'GENESEED_LLM', 'CLAUDE_PROJECT_DIR']) delete env[k];
    const rows = [
      ['install only above the project dir (mono2/.claude, project mono2/pkg)', pkg2, pkg2, 'ask'],
      ['installs above but none in the project dir (project mono/pkg/sub)', sub, sub, 'ask'],
      ['the project dir carries its own install (mono/pkg)', pkg, pkg, 'defer'],
      ['the monorepo root is the project dir', mono, mono, 'defer'],
      ['no $CLAUDE_PROJECT_DIR (Bob): cwd mono2/pkg, install only above it', null, pkg2, 'ask'],
      ['no $CLAUDE_PROJECT_DIR (Bob): cwd carries its own install', null, pkg, 'defer'],
      // M-3: a hand-written `-global` emit in a project `.claude/` reads as a global. The result
      // is a doubled ask, which is deliberate — never "fix" it into silence.
      ['a project .claude/ carrying a hand-written claude-global emit marker', hand, hand, 'ask'],
    ];
    for (const [label, cpd, cwd, want] of rows) {
      const r = hookRun('git-gate', { root: work, stdin: bashPayload('git push --force'), cwd,
        env: cpd ? { ...env, CLAUDE_PROJECT_DIR: cpd } : env });
      if (want === 'ask') askDecision(r, label); else assertDefers(r, label);
    }
  } finally { sb.cleanup(); }
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

// ---------------------------------------------------------------------------------------------
// Bob's REAL payload shape (bob-verdict.md I1): `{event, session_id, tool, input:{...}}` — no
// `tool_input`, `tool_name` or `hook_event_name`. `tool-gate` is the only verb Bob's settings.json
// ever invokes (settings.mjs:519), so normalising must happen there. Before the fix, `toolGate`
// reads `payload.tool_input` (absent -> `{}`), always falls through to `ruleDecide`, which reads
// `payload.tool_input` again (still absent) and defers on every call — Law I, Law IV and
// rigor-5 are a silent no-op on every real Bob tool call.
const bobPayload = (tool, input) => JSON.stringify({ event: 'PreToolUse', session_id: 'ses_1', tool, input });

test('bob-shaped write_file with a secret still blocks (rc 2), not a silent defer', () => {
  const r = hookRun('tool-gate', {
    stdin: bobPayload('write_file', { path: 'src/a.js', content: 'AKIAIOSFODNN7EXAMPLE' }),
    host: 'bob',
  });
  assert.equal(r.rc, 2, `write_file/secret: expected exit 2, got ${r.rc}, stderr=${r.err}`);
  assert.match(r.err, /Sealed Secrets/);
});

test('bob-shaped execute_command with a destructive git act still blocks (rc 2)', () => {
  const r = hookRun('tool-gate', {
    stdin: bobPayload('execute_command', { command: 'git push --force' }),
    host: 'bob',
  });
  assert.equal(r.rc, 2, `execute_command/force-push: expected exit 2, got ${r.rc}, stderr=${r.err}`);
  assert.match(r.err, /Deletion Is Deliberate/);
});

test('a Claude-shaped payload is unchanged by the Bob normalisation', () => {
  // Same assertion as the existing Bob dialect test above, re-run through `tool-gate` with the
  // ALREADY-Claude-shaped payload, to prove the new normalisation step is a no-op here: nothing
  // it sets (`tool_input`, `tool_name`, `hook_event_name`) was missing to begin with.
  const r = hookRun('tool-gate', { stdin: bashPayload('git push --force'), host: 'bob' });
  assert.equal(r.rc, 2, `claude-shaped unchanged: expected exit 2, got ${r.rc}`);
  assert.match(r.err, /Deletion Is Deliberate/);
  // process-5 (consent) has no block tier on Bob: a stderr nudge, exit 0 — a defer, not a block.
  assertDefers(hookRun('tool-gate', { stdin: bashPayload('git push'), host: 'bob' }), 'tool-gate/claude-shaped/consent');
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

// ---------------------------------------------------------------------------------------------
// THE ROOT-SCAN CHECK (Commands Must Return, `ops-2`). On 2026-10-10 a subagent ran
// `find / -iname "write.ts" … | head -5` in Git Bash, where `/` mounts every drive and a network
// share: 3.5 h at 100 % CPU, and the Bash timeout did not stop the orphaned child. A recursive
// scan whose argument is a whole filesystem root asks; the same scan of any deeper path defers.
// The first two tables are Ritus/guards/root_scan.py's own self-check, ported as they are; the
// POSIX table adds the wrapper/env/path-to-binary shapes; the last table pins the tightening of
// the reference's recursion regex (its `-[a-z]*r[a-z]*` under `/i` read `-Force` and `-Filter`
// as a recursion flag, which on Bob and OpenCode would be a hard block, not a prompt).

const REF_REFUSE = [
  'find / -iname "write.ts" -path "*opencode*" 2>/dev/null | head -5',
  'cd x && find /c -name foo',
  'find /x -type f',
  'du -sh /',
  'grep -rl foo /',
  'rg needle C:\\',
  'ls -R /d',
  'Get-ChildItem -Path C:\\ -Recurse -Filter x.ts',
  'gci C:/ -Recurse',
];
const REF_PASS = [
  'find . -name x',
  'find /c/Users/guill/Documents/git/Terra -name x',
  "ssh nas 'find / -name x'",
  'ls /',
  'grep foo /',
  'du -sh /tmp',
  'Get-ChildItem C:\\',
  'echo find /',
];
// Wrappers, an env assignment and a path to the binary are still the scanner running; `/mnt/c`
// is WSL's drive root. A scan of a real directory, or a scanner word that is only an argument,
// is ordinary work.
const POSIX_REFUSE = [
  'sudo find / -name x',
  'FOO=1 time du -sh /',
  '/usr/bin/find / -name x',
  'tree /',
  'fd needle /',
  'find /mnt/c -name x',
  'grep --recursive foo /',
  'ls -la; find / -name x',
  'true || du /\nfind / -name x',
  // A glob on the root is the root: the shell expands `/*` to /c, /d, /x before du ever runs.
  'du -sh /*',
  'find /* -name x',
  'ls -R /c/*',
];
const POSIX_PASS = [
  'find /usr -name x',
  'grep -r foo .',
  'ls -R ./src',
  'du -sh /var/log',
  'rg needle node_modules',
  'git log --grep=find /',
  'ls /*',
];
// PowerShell parameters that merely CONTAIN an `r` are not -Recurse; its prefix abbreviations are.
const PS_CASES = [
  ['gci C:\\ -Force', false],
  ['Get-ChildItem C:\\ -Filter x', false],
  ['Get-ChildItem C:\\ -ErrorAction SilentlyContinue', false],
  ['gci C:\\ -r', true],
  ['gci C:\\ -Rec -Include x.ts', true],
  ['dir C:\\ -Recurse', true],
];

// Review fix round. `ls`/`dir` recurse only on an UPPERCASE `-R` cluster, `--recursive` or a
// PowerShell `-Recurse` prefix — `ls -r` is REVERSE, so `-ltr`/`-lr` list one directory. `-r`
// stays recursive for grep only. A QUOTED single-letter-colon token is data (a grep pattern), never
// a drive root; an unquoted `C:` still is. The program word loses its leading path (either slash)
// and an `.exe` suffix, and PowerShell's colon binding `-Path:C:\` reads like `-Path C:\`.
const FIX_CASES = [
  ['ls -ltr /', false],
  ['ls -lr /c', false],
  ['ls -Force C:\\', false],
  ['ls -R /', true],
  ['ls C:\\ -Recurse', true],
  ['dir C:\\ -Recurse', true],
  ['grep -rn "a:" src', false],
  ['rg "e:" src', false],
  ["rg 'e:' src", false],
  ['rg needle C:', true],
  ['find.exe / -name x', true],
  ['C:\\tools\\rg.exe x C:\\', true],
  ['Get-ChildItem -Path:C:\\ -Recurse', true],
  ['where.exe /r C:\\ x.dll', true],
];

test('rootScan: ls -r is reverse, quoted "a:" is data, .exe and -Path: are still the scan', async () => {
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const [c, refused] of FIX_CASES) assert.equal(Boolean(rootScan(c)), refused, c);
});

// Final review: segments split only on separators OUTSIDE quotes, and a heredoc body (from
// `<<TAG`/`<<'TAG'`/`<<-TAG` to the TAG line) is data, never a command. Without both, a commit
// message that merely DESCRIBES a root scan — this machine's mandated `git commit -F - <<'EOF'`
// form, or a quoted `-m` — reads as one, and on Bob and OpenCode that blocks the commit. A real
// separator, or a command after the terminator, is still scanned.
const QUOTE_HEREDOC_CASES = [
  ["git commit -F - <<'EOF'\nfind / -name x\nEOF", false],
  ['git commit -F - <<EOF\nfind / -name x\nEOF', false],
  ['cat <<-EOF\n\tfind / -name x\n\tEOF', false],
  ['cat << "EOF"\r\nfind / -name x\r\nEOF\r\n', false],
  ['git commit -m "fix; find / loop"', false],
  ['echo "x | du -sh /"', false],
  ["cat <<'EOF'\nhi\nEOF\nfind / -name x", true],
  ['echo a; find / -name x', true],
  ["find / -name 'a;b'", true],
  ['cat <<< "x"; find / -name x', true],
  ['git commit -m "a" && find / -name x', true],
];

test('rootScan: quoted separators and heredoc bodies are data, real separators still cut', async () => {
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const [c, refused] of QUOTE_HEREDOC_CASES) assert.equal(Boolean(rootScan(c)), refused, c);
});

test('rootScan: never throws and stays linear on pathological input', async () => {
  // A throw becomes a gate-error ask (a warning on Bob); a backtracking blow-up becomes a hook
  // timeout, which `onFailure: "block"` turns into a refused call. Neither is acceptable.
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const c of ['find / <<', 'find <<EOF\n'.repeat(100000), 'find / '.concat('<<'.repeat(200000)),
    '"\''.repeat(500000) + ' find /', 'find / "'.repeat(100000), 'find <<-\t'.repeat(100000),
    'ls; '.repeat(250000) + 'find / -name x', 'find \0 / \uD800 <<', 'find <<A\r\n'.repeat(100000)]) {
    const t = Date.now();
    rootScan(c);
    assert.ok(Date.now() - t < 2000, `rootScan took ${Date.now() - t} ms on ${c.slice(0, 20)}`);
  }
});

test('rootScan: the reference self-check — 9 refused, 8 passed', async () => {
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const c of REF_REFUSE) assert.ok(rootScan(c), `should refuse: ${c}`);
  for (const c of REF_PASS) assert.equal(rootScan(c), null, `should pass: ${c}`);
});

test('rootScan: POSIX wrappers and paths refuse; deeper directories pass', async () => {
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const c of POSIX_REFUSE) assert.ok(rootScan(c), `should refuse: ${c}`);
  for (const c of POSIX_PASS) assert.equal(rootScan(c), null, `should pass: ${c}`);
});

test('rootScan: only a real recursion flag makes a PowerShell listing a scan', async () => {
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  for (const [c, refused] of PS_CASES) assert.equal(Boolean(rootScan(c)), refused, c);
});

test('rootScan: names the offending segment, and keeps C:\\ apart from the next token', async () => {
  // A POSIX lexer would read `C:\ -Recurse` as ONE token (`C: -Recurse`), and the root would never
  // be seen — the Windows trap the reference's `posix=False` exists for.
  const { rootScan } = await import('../../js/hosts/hooks.mjs');
  assert.equal(rootScan('cd x && find /c -name foo'), 'find /c -name foo');
  assert.equal(rootScan('Get-ChildItem C:\\ -Recurse'), 'Get-ChildItem C:\\ -Recurse');
});

test('git-gate asks on a root scan citing Commands Must Return, even with --no-consent', () => {
  for (const extra of [[], ['--no-consent']]) {
    const dec = askDecision(hookRun('git-gate', { extra, stdin: bashPayload('find / -name x') }),
      `root scan ${extra.join(' ')}`);
    assert.match(dec.permissionDecisionReason, /Commands Must Return/);
    assert.match(dec.permissionDecisionReason, /specific directory/);
  }
  assertDefers(hookRun('git-gate', { stdin: bashPayload('find . -name x') }), 'find .');
});

test('a root scan is ledgered as ops-2, and Bob blocks it (exit 2) on either payload shape', () => {
  withLedgerRoot((root, ledger) => {
    askDecision(hookRun('git-gate', { root, stdin: bashPayload('du -sh /') }), 'du /');
    assert.deepEqual(fs.readFileSync(ledger, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l).rule), ['ops-2']);
  });
  for (const stdin of [bashPayload('find / -name x'),
    bobPayload('execute_command', { command: 'find / -name x' })]) {
    const r = hookRun('tool-gate', { stdin, host: 'bob' });
    assert.equal(r.rc, 2, `bob root scan: expected exit 2, got ${r.rc}, stderr=${r.err}`);
    assert.match(r.err, /BLOCKED: Geneseed \(Commands Must Return\)/);
  }
});
