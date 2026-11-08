/**
 * THE GATE VERDICT TABLE: what each gate DECIDES, never what it says.
 *
 * WHY IT EXISTS (spec 2026-11-07-gate-prompts-5.0.3, D18). The gate texts are being rewritten.
 * Most tests that touch a gate read its words, so a rewrite that accidentally flipped an `ask` to a
 * pass, or a block to a warning, could hide behind green text tests. This table reads only the
 * decision and the exit code, so a text change cannot move it, and a verdict change cannot hide.
 * S2 and S3 of that spec must not edit this file; a row changes only when a gate's decision does,
 * and then the row and the sentence above it change together, with the reason in the commit.
 *
 * THE VERDICTS, as one reads them off the process or the guard:
 *   ask    Claude/OpenClaude: exit 0 and `permissionDecision: "ask"` on stdout (a prompt).
 *   deny   Claude/OpenClaude: exit 0 and `permissionDecision: "deny"` (the ownership gate only).
 *          OpenCode guard: the call is refused (V1 throws, V2 renames the call).
 *   exit2  Bob: exit code 2. Bob has no ask tier, so a rule that would ask elsewhere blocks there.
 *   warn   Bob: exit 0, stdout empty, a `[geneseed]` line on stderr. The call runs.
 *   pass   exit 0, nothing on stdout, nothing on stderr: the gate defers.
 *   note   Claude/OpenClaude: exit 0 and `additionalContext` on stdout: the call runs, the agent is told.
 *   ask    OpenCode V2, after the tool hook passes: the `evaluate` hook raises the host's own prompt.
 *
 * THE HOSTS. `claude` and `openclaude` share one expectation: OpenClaude speaks Claude's dialect
 * verbatim (`js/hosts/hooks.mjs`, header), and the table runs both so a split would show. `bob`
 * is the `tool-gate` verb with Bob's payload shape. `v1` is the OpenCode guard's
 * `tool.execute.before` run directly; `v2` is the same plugin through `setup(ctx)`, which cannot
 * throw and so renames a refused call, then asks `evaluate` what the host would do with a call it
 * let through. A column that is `null` is not routed to the gate on that host.
 *
 * Every expected value is written out in the row; the sentence in `rule` states the rule behind
 * it. Asserts decision and exit code only, never reason text.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { HOME_VARS, RELOCATION_VARS, cellEnv, homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
import { makeLossWorkspace } from '../helpers/loss_repos.mjs';
import { claudeHookGroups } from '../../js/hosts/settings.mjs';
import { doctrinesOfDir, excludedRulesOfDir } from '../../js/hosts/installs.mjs';
import { PACK_ORDER } from '../../js/build/source.mjs';

// ---- the fixture: every path lives in one sandbox ------------------------------------------
const sb = makeSandbox('gsverdict-');
const ENV_KEYS = [...HOME_VARS, ...RELOCATION_VARS, 'TMP', 'TEMP', 'TMPDIR', 'OPENCODE_CONFIG_DIR', 'GENESEED_MEMORY',
  'GENESEED_WIKI', 'GENESEED_HARNESS', 'GENESEED_GUARD', 'GENESEED_GATE_PROBE'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const mk = (...p) => { const d = path.join(sb.path, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const install = mk('install');             // `--root`: a deployed install
mk('install', 'memory');
// A memory file that is user-rules.md under a second name (a hard link has no target to follow), and
// one memory file with a single name. Both exist, so the gate can stat them.
// The install's own rule file (`--root` is the install), so the gate knows it and matches its inode.
const RULES_SRC = path.join(install, 'user-rules.md');
fs.writeFileSync(RULES_SRC, 'a rule\n');
const HARD = path.join(install, 'memory', 'hard.md');
fs.linkSync(RULES_SRC, HARD);
const SINGLE = path.join(install, 'memory', 'single.md');
fs.writeFileSync(SINGLE, 'a fact\n');
const proj = mk('proj');                   // a plain git project: no build manifest, so no ownership gate
mk('proj', '.git');
mk('proj', 'src');
// Outside every memory store: one more name of the install's rules, and a hard-linked pair that is
// no rule file at all (the pnpm-store shape).
const HARD_OUTSIDE = path.join(proj, 'src', 'rules-alias.md');
fs.linkSync(RULES_SRC, HARD_OUTSIDE);
// The project layer's own rule file, known only through the session's directory, and a memory file
// that is a second name of it.
const PROJECT_RULES = path.join(proj, 'user-rules.md');
fs.writeFileSync(PROJECT_RULES, 'a project rule\n');
const PROJECT_HARD = path.join(install, 'memory', 'project-hard.md');
fs.linkSync(PROJECT_RULES, PROJECT_HARD);
const PLAIN_PAIR = path.join(proj, 'src', 'vendored.js');
fs.writeFileSync(path.join(proj, 'src', 'store-copy.js'), 'module.exports = 1\n');
fs.linkSync(path.join(proj, 'src', 'store-copy.js'), PLAIN_PAIR);
mk('proj', '.geneseed');
fs.writeFileSync(path.join(proj, '.geneseed', 'protected-checks.txt'), 'ci.yml\n');
const BLOCK_OF = (body) => `<!-- BEGIN GENESEED -->\n${body}\n<!-- END GENESEED -->`;
mk('proj', 'pkg');                         // a shared carrier: the user's notes around a managed block
const CARRIER = path.join(proj, 'pkg', 'CLAUDE.md');
const CARRIER_TEXT = `# notes\n${BLOCK_OF('Done gate: off\nExternal gate: on')}\n# tail\n`;
fs.writeFileSync(CARRIER, CARRIER_TEXT);
mk('proj', 'big');
// Over the cap in bytes, under it in characters: only the size on disk can catch it.
fs.writeFileSync(path.join(proj, 'big', 'CLAUDE.md'), `# one\n${'\u00e9'.repeat(600 * 1024)}\n`);
mk('proj', 'dir', 'CLAUDE.md');
const app = mk('app');                     // an application repo: a build manifest, no AGENTS.md
mk('app', '.git');
fs.writeFileSync(path.join(app, 'package.json'), '{}');
const brain = mk('Brain', 'Codex');         // a protected wiki folder, declared in the manifest below
fs.writeFileSync(path.join(sb.path, 'wikis.jsonc'), JSON.stringify({ wikis: [{ name: 'Brain', path: path.join(sb.path, 'Brain'), protected: ['Codex/'] }] }));
const loop = mk('loop');                   // a launched loop: branch loop/x, and LOOP.md carrying the state marker
mk('loop', '.git');
fs.writeFileSync(path.join(loop, '.git', 'HEAD'), 'ref: refs/heads/loop/x\n');
fs.writeFileSync(path.join(loop, 'LOOP.md'), '<!-- loop-state:begin -->\n');
// A repository with two LINKED worktrees, written as git lays them out: each worktree's `.git` is
// a file naming `<main>/.git/worktrees/<n>`, whose `commondir` names the shared `.git`. `wt` is on
// a feature branch, `wtMain` has the default branch checked out; `wtRepo` is the main checkout.
const wtRepo = mk('wtrepo');
mk('wtrepo', '.git', 'refs', 'heads');
fs.writeFileSync(path.join(wtRepo, '.git', 'HEAD'), 'ref: refs/heads/trunk\n');
mk('wtrepo', 'src');
mk('wtrepo', '.git', 'refs', 'remotes', 'origin');
fs.writeFileSync(path.join(wtRepo, '.git', 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/stable\n');
const linked = (name, branch) => {
  const gd = mk('wtrepo', '.git', 'worktrees', name);
  fs.writeFileSync(path.join(gd, 'HEAD'), `ref: refs/heads/${branch}\n`);
  fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
  const dir = mk(`wt-${name}`);
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gd}\n`);
  return dir;
};
const wt = linked('feat', 'feat/x');
const wtMain = linked('main', 'main');
// Each one shared by a different rule: a case spelling of main, the doctrine's names, a remote's
// HEAD, and the branch the main worktree (`wtRepo`, on `trunk`) has checked out.
const wtCase = linked('case', 'Main');
const wtDevelop = linked('develop', 'develop');
const wtRelease = linked('release', 'release/1.2');
const wtStable = linked('stable', 'stable');
const wtTrunk = linked('trunk', 'trunk');
// A branch that is a symref alias of a shared one: a commit on `sym` moves `develop`.
const wtSym = linked('sym', 'sym');
fs.writeFileSync(path.join(wtRepo, '.git', 'refs', 'heads', 'sym'), 'ref: refs/heads/develop\n');
// A junction inside the worker's worktree whose physical target is the main checkout's tree.
fs.symlinkSync(path.join(wtRepo, 'src'), path.join(wt, 'jx'), 'junction');
const tmp = mk('tmp');                     // the ownership marker lives under the OS temp dir

// The child hook processes and this process both see the sandbox as home and as temp dir. Set
// after `makeSandbox` (which sizes itself from the real temp root) and undone in `after`.
// `cellEnv` drops the ambient CLAUDE_/BOB_/OPENCLAUDE_/OPENCODE_CONFIG_DIR and every GENESEED_ knob but the home.
const base = { ...cellEnv(sb.path), TMP: tmp, TEMP: tmp, TMPDIR: tmp };
for (const k of RELOCATION_VARS) delete process.env[k];
Object.assign(process.env, homeOverrides(sb.path), { TMP: tmp, TEMP: tmp, TMPDIR: tmp,
  OPENCODE_CONFIG_DIR: path.join(sb.path, 'oc-config'), GENESEED_MEMORY: path.join(install, 'memory'),
  GENESEED_WIKI: path.join(sb.path, 'wikis.jsonc') });
delete process.env.GENESEED_HARNESS; delete process.env.GENESEED_GUARD; delete process.env.GENESEED_GATE_PROBE;

const ws = makeLossWorkspace();
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  ws.cleanup();
  sb.cleanup();
});

// The guard reads its switches at import, so it loads after the environment above is in place.
const guardModule = (await import(pathToFileURL(path.resolve('adapters/opencode/plugins/geneseed-guard.js')).href)).default;
const { GeneseedGuard } = await import(pathToFileURL(path.resolve('adapters/opencode/plugins/geneseed-guard.js')).href);

const SECRET = 'AKIAIOSFODNN7EXAMPLE';   // AWS's published example key: shaped like a credential, grants nothing
// The builds the exclusion rows run under, and the carrier each one renders: the two marker lines,
// spelled as js/build/render.mjs writes them (a test below reads them back with the build's own readers).
const BUILDS = {
  p1: { excluded: ['process.1'] },
  o2: { excluded: ['ops.2'] },
  packs: { doctrines: ['craft', 'rigor', 'comms'] },
};
const carrierDir = (build) => path.join(sb.path, 'carriers', build);
for (const [name, { doctrines = PACK_ORDER, excluded = [] }] of Object.entries(BUILDS)) {
  fs.mkdirSync(carrierDir(name), { recursive: true });
  fs.writeFileSync(path.join(carrierDir(name), 'AGENT.md'), `# AGENT.md\n\nActive packs: ${doctrines.join(', ')}\n`
    + (excluded.length ? `Excluded rules: ${excluded.map((id) => id.replace('.', ' ')).join(', ')}\n` : ''));
}

// ---- the table -----------------------------------------------------------------------------
// kind: `shell` (a command), `write` (a path and content), `edit` (a path, `old` and `now`), `read` (a path), `raw` (stdin as is).
// `at` is the working directory; `ws` runs in the loss workspace's repository.
// `session` adds a session id (only the ownership gate reads one). `extra` is hook argv. `ps` names
// the PowerShell tool rather than Bash: only that says a here-string is one when no cmdlet does.
const ROWS = [
  // ---- Law I, Sealed Secrets
  { id: 'law-1 secret in a source file', kind: 'write', path: () => path.join(proj, 'src', 'a.js'), content: `k = "${SECRET}"`,
    rule: 'A credential-shaped string written into a tracked file asks on Claude, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'law-1 secret in .env', kind: 'write', path: () => path.join(proj, '.env'), content: `K=${SECRET}`,
    rule: 'The same string in .env is where Law I says a secret may live, so every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'law-1 secret with the gate off', kind: 'write', path: () => path.join(proj, 'src', 'a.js'), content: `k = "${SECRET}"`,
    extra: ['--no-secrets-gate'], rule: '--no-secrets-gate switches the content scan off on the hook hosts.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'law-1 write to an ssh key path', kind: 'write', path: () => path.join(sb.path, '.ssh', 'id_rsa'), content: 'k',
    rule: 'Only the OpenCode guard refuses a key path by name; the hooks scan content, not names.',
    claude: 'pass', bob: 'pass', v1: 'deny', v2: 'deny' },
  { id: 'ordinary write', kind: 'write', path: () => path.join(proj, 'src', 'b.txt'), content: 'hello',
    rule: 'Ordinary work passes everywhere: a gate that asks here is a lockout.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'ordinary command', kind: 'shell', cmd: () => 'ls -la',
    rule: 'A command that is neither a commit, a loss, a scan nor a write passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'a read of a rule store', kind: 'read', path: () => path.join(sb.path, 'user-rules.md'),
    rule: 'Bob routes reads to the rule gate and a read is nobody\'s business; Claude never routes one. The guard passes a read tool.',
    claude: null, bob: 'pass', v1: 'pass', v2: 'pass' },
  // ---- Law IV, Deletion Is Deliberate
  { id: 'law-4 catastrophic', kind: 'shell', cmd: () => 'rm -rf /',
    rule: 'A command that would destroy a root asks on Claude, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'law-4 catastrophic with the deletion gate off', kind: 'shell', cmd: () => 'rm -rf /', extra: ['--no-deletion-gate'],
    rule: 'The catastrophic class stands even with the deletion gate off: only the real-loss check stands down.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'law-4 reflog expire', kind: 'shell', cmd: () => 'git reflog expire --expire=now --all',
    rule: 'An act that loses data in every state asks and blocks; the guard leaves it to its static permission glob.',
    claude: 'ask', bob: 'exit2', v1: 'pass', v2: 'pass' },
  { id: 'law-4 loss: delete a protected branch', kind: 'shell', ws: true, cmd: () => 'git branch -D main',
    rule: 'A real loss (a protected branch deleted) asks, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'law-4 no loss: delete a pushed branch', kind: 'shell', ws: true, cmd: () => 'git branch -D pushed',
    rule: 'The same verb on a branch whose commits live on a remote loses nothing, so it passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'law-4 loss with the deletion gate off', kind: 'shell', ws: true, cmd: () => 'git branch -D main', extra: ['--no-deletion-gate'],
    rule: '--no-deletion-gate stands the real-loss check down on the hooks (the catastrophic class stays).',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  // ---- Commands Must Return (ops-2)
  { id: 'ops-2 root scan', kind: 'shell', cmd: () => 'find / -name x',
    rule: 'A recursive scan of a filesystem root asks on Claude, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  // ---- External Gate (rigor-5)
  { id: 'rigor-5 protected check, by tool', kind: 'write', path: () => path.join(proj, 'ci.yml'), content: 'on: push',
    rule: 'A file listed in .geneseed/protected-checks.txt asks on Claude, blocks on Bob, is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 protected check, by shell', kind: 'shell', cmd: () => `echo x > "${path.join(proj, 'ci.yml')}"`,
    rule: 'A parsed shell write to a protected check is gated like the write tool.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 gate config, by tool', kind: 'write', path: () => path.join(proj, '.claude', 'excludes.json'), content: '{}',
    rule: 'A gate\'s own configuration (the exclusion list) asks, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 gate config, by shell', kind: 'shell', cmd: () => `echo x > "${path.join(proj, '.claude', 'excludes.json')}"`,
    rule: 'A parsed shell write to the exclusion list is gated like the write tool.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 hook settings, wiring untouched', kind: 'write', path: () => path.join(proj, '.claude', 'settings.json'), content: '{"theme":"x"}',
    rule: 'Hook settings ask on Claude; Bob passes a write that leaves Geneseed\'s wiring alone; OpenCode asks natively (the guard passes, V2 raises the ask).',
    claude: 'ask', bob: 'pass', v1: 'pass', v2: 'ask' },
  { id: 'rigor-5 hook settings, wiring changed', kind: 'write', path: () => path.join(proj, '.claude', 'settings.json'),
    content: JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node geneseed-hook tool-gate' }] }] } }),
    rule: 'A settings write that adds a Geneseed hook entry blocks on Bob, where the same file otherwise passes.',
    claude: 'ask', bob: 'exit2', v1: 'pass', v2: 'ask' },
  { id: 'rigor-5 opencode.json', kind: 'write', path: () => path.join(proj, 'opencode.json'), content: '{}',
    rule: 'OpenCode\'s own config asks on Claude, passes on Bob (which never reads it) and is asked natively by OpenCode.',
    claude: 'ask', bob: 'pass', v1: 'pass', v2: 'ask' },
  { id: 'rigor-5 gate config, by shell: hook settings', kind: 'shell', cmd: () => `echo x > "${path.join(proj, '.claude', 'settings.json')}"`,
    rule: 'A shell write to hook settings asks on Claude; Bob cannot replay a command as an edit so it blocks; OpenCode asks natively for edit tools only, so a shell write is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 gate config, by shell: opencode.json', kind: 'shell', cmd: () => `echo x > "${path.join(proj, 'opencode.json')}"`,
    rule: 'The same shell write to opencode.json asks on Claude, passes on Bob (which never reads that file) and is refused by the guard.',
    claude: 'ask', bob: 'pass', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 hook settings after an "always"', kind: 'write', path: () => path.join(proj, '.claude', 'settings.json'), content: '{"theme":"x"}',
    v1as: 'always', rule: 'Once the user answered "always" to an edit prompt (OpenCode V1), the host ask on hook settings is gone, so the guard refuses what it would otherwise pass.',
    claude: 'ask', bob: 'pass', v1: 'deny', v2: 'ask' },
  // The guard reads `<cfg>/AGENT.md` before a project's own carrier, so a file planted there would set
  // its gate markers and rule exclusions: it is the guard's gate configuration. Here `<cfg>` is the
  // plugin dir's parent, adapters/opencode. Only OpenCode reads it, so the hooks pass it.
  { id: 'rigor-5 the guard\'s own-dir AGENT.md, by tool', kind: 'write', path: () => path.resolve('adapters', 'opencode', 'AGENT.md'), content: 'Excluded rules: process 1',
    rule: 'OpenCode asks natively (the emit writes a permission.edit key, V2 raises the ask); the hooks never read it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'ask' },
  { id: 'rigor-5 the guard\'s own-dir AGENT.md after an "always"', kind: 'write', path: () => path.resolve('adapters', 'opencode', 'AGENT.md'), content: 'Excluded rules: process 1',
    v1as: 'always', rule: 'Once the user answered "always" to an edit prompt (OpenCode V1), the guard refuses it, as it refuses the other gate files.',
    claude: 'pass', bob: 'pass', v1: 'deny', v2: 'ask' },
  { id: 'rigor-5 the guard\'s own-dir AGENT.md, by shell', kind: 'shell', cmd: () => `echo x > "${path.resolve('adapters', 'opencode', 'AGENT.md')}"`,
    rule: 'A shell write to it reaches no edit prompt, so the guard refuses it on both OpenCode versions.',
    claude: 'pass', bob: 'pass', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 NTFS stream', kind: 'write', path: () => path.join(proj, 'src', 'a.js:stream'), content: 'x',
    rule: 'A stream name writes through to its file on Windows, where the guard refuses it; elsewhere a colon is an ordinary file name. The hooks fold the stream and judge the file, an ordinary source file.',
    claude: 'pass', bob: 'pass', v1: process.platform === 'win32' ? 'deny' : 'pass', v2: process.platform === 'win32' ? 'deny' : 'pass' },
  { id: 'wiki: a protected folder', kind: 'write', path: () => path.join(brain, 'note.md'), content: 'x',
    rule: 'Only the OpenCode guard reads the wiki manifest: a mutation inside a protected wiki folder is refused; the hooks never see the manifest.',
    claude: 'pass', bob: 'pass', v1: 'deny', v2: 'deny' },
  { id: 'a tool whose arguments nest too deep', kind: 'tool', tool: 'mcp_notes_store', args: () => (() => { let o = { target: 'x' }; for (let i = 0; i < 40; i += 1) o = { nest: o }; return o; })(),
    rule: 'What the guard cannot read it refuses: arguments nested past its bound could hide a rule-store path. Guard only: no hook routes an unknown tool.',
    claude: null, bob: null, v1: 'deny', v2: 'deny' },
  { id: 'a rule store through a non-edit tool', kind: 'tool', tool: 'mcp_notes_store', args: () => ({ target: path.join(sb.path, 'user-rules.md') }),
    rule: 'A tool the host\'s edit prompt does not cover cannot reach a prompt, so a write it names to a rule store is refused. Guard only.',
    claude: null, bob: null, v1: 'deny', v2: 'deny' },
  // ---- Persist Insight (process-1). Only a standing rule is the user's call: user-rules.md and the
  // rule draft ask, block or are refused. Memory is written freely and shown afterwards (owner decision,
  // 2026-11-08), so a memory file and the memory index pass on every host, by tool and by shell.
  { id: 'process-1 rule store, by tool', kind: 'write', path: () => path.join(sb.path, 'user-rules.md'), content: 'a rule',
    rule: 'A write to a rule store asks on Claude and blocks on Bob. OpenCode V1 has no prompt wired here so the guard refuses; V2 lets the host ask.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'process-1 memory file, by tool', kind: 'write', path: () => path.join(install, 'memory', 'fact.md'), content: 'a fact',
    rule: 'A markdown file inside the install\'s memory folder is memory, written freely: every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 memory index, by tool', kind: 'write', path: () => path.join(install, 'memory', 'MEMORY.md'), content: '- a fact',
    rule: 'The memory index is memory too: every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 memory file, by shell', kind: 'shell', cmd: () => `echo x > "${path.join(install, 'memory', 'a.md')}"`,
    rule: 'A shell write to a memory file passes too: the change report shows it afterwards.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 rule draft, by tool', kind: 'write', path: () => path.join(sb.path, 'user-rules.draft.md'), content: 'a rule',
    rule: 'The twin of the memory rows: the rule draft is a rule store, with the rule store\'s verdicts.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'process-1 rule draft, by shell', kind: 'shell', cmd: () => `echo x > "${path.join(sb.path, 'user-rules.draft.md')}"`,
    rule: 'The twin of the memory shell row: a shell write to the rule draft gets the rule store\'s shell verdicts.',
    claude: 'ask', bob: 'warn', v1: 'deny', v2: 'ask' },
  { id: 'process-1 a memory file hard-linked to a rule store, by tool', kind: 'write', path: () => HARD, content: 'a rule',
    rule: 'A hard link has no target to follow, so a file with a second name may be user-rules.md: it gets the rule store\'s verdicts.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'process-1 a memory file hard-linked to a rule store, by shell', kind: 'shell', cmd: () => `echo x > "${HARD}"`,
    rule: 'The same file through a parsed shell write gets the rule store\'s shell verdicts.',
    claude: 'ask', bob: 'warn', v1: 'deny', v2: 'ask' },
  { id: 'process-1 the hard-linked memory file, spelled as Git Bash spells it', kind: 'write',
    path: () => (process.platform === 'win32' ? `/${HARD[0].toLowerCase()}${HARD.slice(2).replace(/\\/g, '/')}` : HARD), content: 'a rule',
    rule: 'On Windows /c/... names the C: drive path, so it lands on the same file and gets its verdicts (elsewhere the row is the plain path).',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'process-1 a repository file hard-linked to a rule store, by tool', kind: 'write', path: () => HARD_OUTSIDE, content: 'a rule',
    rule: 'The match is on the rule file, not on the folder: a second name anywhere gets the rule store\'s verdicts.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'process-1 a hard link to the project\'s rule file, a payload with no cwd', kind: 'raw',
    stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: PROJECT_HARD, content: 'a rule' } }),
    rule: 'With no cwd the hook judges from its own directory, the session\'s: the project layer\'s rule file is still known. The guard always has a directory.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'process-1 a hard-linked file that is no rule file, by tool', kind: 'write', path: () => PLAIN_PAIR, content: 'x',
    rule: 'A file with a second name whose inode matches no known rule file is ordinary work (a pnpm store links its files this way): every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 an existing memory file with one name, by tool', kind: 'write', path: () => SINGLE, content: 'a fact',
    rule: 'The twin: an existing memory file with a single name (nlink 1) is memory, written freely.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 rule store, host prompt known (OpenCode V1)', kind: 'write', path: () => path.join(sb.path, 'user-rules.md'), content: 'a rule',
    v1as: 'prompted', rule: 'When the merged OpenCode config asks for every edit, V1 passes the write to the host\'s own prompt instead of refusing it.',
    claude: 'ask', bob: 'exit2', v1: 'pass', v2: 'ask' },
  { id: 'process-1 rule store, by shell without a program word', kind: 'shell', cmd: () => `> "${path.join(sb.path, 'user-rules.md')}"`,
    rule: 'A bare redirect has no program word, so the host\'s parser asserts nothing and V2 cannot raise a prompt: the guard refuses it on both. The hooks ask (Claude) or warn (Bob).',
    claude: 'ask', bob: 'warn', v1: 'deny', v2: 'deny' },
  { id: 'process-1 rule store, by shell', kind: 'shell', cmd: () => `echo x > "${path.join(sb.path, 'user-rules.md')}"`,
    rule: 'A shell write to a store asks on Claude but only WARNS on Bob (shell is no boundary). V1 refuses; V2 raises the host\'s ask.',
    claude: 'ask', bob: 'warn', v1: 'deny', v2: 'ask' },
  // ---- PowerShell's writers (5.0.2): each form is judged as the same write through a redirect is
  { id: 'rigor-5 protected check, by Add-Content', kind: 'shell', cmd: () => `Add-Content -Path "${path.join(proj, 'ci.yml')}" -Value x`,
    rule: 'A cmdlet naming a protected check with -Path is the shell write above: it asks, blocks on Bob and is refused by the guard.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 protected check, by the sc alias', kind: 'shell', cmd: () => `sc "${path.join(proj, 'ci.yml')}" x`,
    rule: 'Set-Content\'s alias takes its path as the first positional, with the same verdicts.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 protected check, by a pipe into Out-File', kind: 'shell', cmd: () => `echo x | Out-File "${path.join(proj, 'ci.yml')}"`,
    rule: 'A pipe into a writer is a segment of its own, so the writer is read the same.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 protected check, by Copy-Item -Destination', kind: 'shell', cmd: () => `Copy-Item a.txt -Destination "${path.join(proj, 'ci.yml')}"`,
    rule: 'The destination of a copy is the file written, named or positional.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 protected check, by Rename-Item', kind: 'shell', cmd: () => `Rename-Item "${path.join(proj, 'ci.yml')}" old.yml`,
    rule: 'A rename removes its source, so renaming a protected check away is a write to it.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'rigor-5 gate config, by Out-File', kind: 'shell', cmd: () => `Out-File -FilePath "${path.join(proj, '.claude', 'excludes.json')}"`,
    rule: 'A cmdlet writing the exclusion list is gated like a redirect to it.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'process-1 rule store, by Set-Content', kind: 'shell', cmd: () => `Set-Content -Path "${path.join(sb.path, 'user-rules.md')}" -Value x`,
    rule: 'A cmdlet writing a store gets the shell verdicts: ask on Claude, a warning on Bob, refused on V1, the host\'s ask on V2.',
    claude: 'ask', bob: 'warn', v1: 'deny', v2: 'ask' },
  { id: 'sc.exe is the service tool', kind: 'shell', cmd: () => 'sc.exe config x',
    rule: 'Only the bare alias is Set-Content: sc.exe writes no file, so it passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'a here-string body in PowerShell', kind: 'shell', ps: true, cmd: () => `$m = @'\nit's done\nAdd-Content "${path.join(proj, 'ci.yml')}" x\n'@`,
    rule: 'In PowerShell a here-string body is data, so a write named inside one is no write.',
    claude: 'pass', bob: null, v1: 'pass', v2: 'pass' },
  { id: 'process-5 commit with a here-string message', kind: 'shell', ps: true, cmd: () => "git commit -m @'\nit's done\n'@",
    rule: 'An apostrophe in a here-string message hides nothing: it is a commit, with a commit\'s verdicts.',
    claude: 'ask', bob: null, v1: 'pass', v2: 'pass' },
  // ---- Consent Before Push (process-5)
  { id: 'process-5 commit', kind: 'shell', cmd: () => 'git commit -m x',
    rule: 'A commit asks on Claude and only warns on Bob; OpenCode asks through its static glob, so the guard passes.',
    claude: 'ask', bob: 'warn', v1: 'pass', v2: 'pass' },
  { id: 'process-5 push', kind: 'shell', cmd: () => 'git push origin feature',
    rule: 'A push to a non-protected branch is still a push: the same verdicts as a commit.',
    claude: 'ask', bob: 'warn', v1: 'pass', v2: 'pass' },
  { id: 'process-5 commit -F inside a launched loop', kind: 'shell', at: () => loop, cmd: () => 'git commit -F msg.txt',
    rule: 'On a loop branch a loop was launched on, the whitelisted commit form is a named batch and passes.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'process-5 commit -F outside a loop', kind: 'shell', cmd: () => 'git commit -F msg.txt',
    rule: 'The same form anywhere else is an ordinary commit: it asks on Claude and warns on Bob.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  // The Foreman worktree batch (user decision 2026-11-08): a dispatched sub-agent's local commit or
  // merge in a LINKED worktree, on a branch that is not shared, is the worker's own named batch.
  // `agent: true` sends Claude Code's subagent fields; Bob sends none, so Bob always warns. Each
  // pass has twins that must ask: no sub-agent, the main checkout, a shared branch, a push, a
  // second command smuggled into an argument, a `cd` that leaves the worktree.
  { id: 'process-5 worker commit in its worktree', kind: 'shell', agent: true, at: () => wt, cmd: () => 'git add -A && git commit -m "merge sub-worker"',
    rule: 'A sub-agent commit in a linked worktree on a feature branch passes; Bob, with no sub-agent field, warns.',
    claude: 'pass', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 worker merge then commit in its worktree', kind: 'shell', agent: true, at: () => wt, cmd: () => 'git merge --no-ff feat/x-sub && git commit --amend --no-edit',
    rule: 'A sub-agent merge of a sub-worker branch, with its commit, passes in the same worktree.',
    claude: 'pass', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 worker cd into its worktree, then commit', kind: 'shell', agent: true, cmd: () => `cd ${wt.split(path.sep).join('/')} && git commit -m x`,
    rule: 'One leading cd into the worktree counts: an agent shell starts in the parent checkout.',
    claude: 'pass', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 session commit in a worktree', kind: 'shell', at: () => wt, cmd: () => 'git add -A && git commit -m "merge sub-worker"',
    rule: 'The same commit with no sub-agent field is a session that runs in a worktree: it asks.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 worker commit in the main checkout', kind: 'shell', agent: true, at: () => wtRepo, cmd: () => 'git add -A && git commit -m "merge sub-worker"',
    rule: 'A sub-agent commit in the main checkout of that repository still asks.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  ...[['main', () => wtMain], ['Main, by case', () => wtCase], ['develop', () => wtDevelop], ['release/1.2', () => wtRelease],
    ['a remote HEAD', () => wtStable], ['the main worktree branch', () => wtTrunk],
    ['a symref alias of develop', () => wtSym]].map(([what, at]) => (
    { id: `process-5 worker commit in a worktree on ${what}`, kind: 'shell', agent: true, at, cmd: () => 'git commit -m x',
      rule: 'A worktree on a shared branch is no worker branch: it asks, whatever the case of the name, and through a symref alias.',
      claude: 'ask', bob: 'warn', v1: null, v2: null })),
  { id: 'process-5 worker push from its worktree', kind: 'shell', agent: true, at: () => wt, cmd: () => 'git push origin HEAD:feat/x',
    rule: 'A push from a worker worktree asks: the batch covers commit and merge, never push.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 worker commit and push in its worktree', kind: 'shell', agent: true, at: () => wt, cmd: () => 'git commit -m x && git push origin HEAD:feat/x',
    rule: 'A command that mixes a commit with a push asks as a whole.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  { id: 'process-5 worker commit with a PowerShell subexpression', kind: 'shell', ps: true, agent: true, at: () => wt,
    cmd: () => `git commit -m x (git -C ${wtRepo.split(path.sep).join('/')} commit -am y)`,
    rule: 'PowerShell runs a parenthesised argument as a command, so it asks.',
    claude: 'ask', bob: null, v1: null, v2: null },
  { id: 'process-5 worker commit with a PowerShell array subexpression', kind: 'shell', ps: true, agent: true, at: () => wt,
    cmd: () => 'git commit -m @(git branch -f main HEAD)',
    rule: 'An @(...) argument runs too, so it asks.',
    claude: 'ask', bob: null, v1: null, v2: null },
  { id: 'process-5 worker cd through a junction to the main checkout', kind: 'shell', agent: true, at: () => wt, cmd: () => 'cd jx && git commit -m x',
    rule: 'A cd is judged by its physical target: a junction into the main checkout asks.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  ...['cd -', 'cd ~', 'cd nowhere'].map((cd) => (
    { id: `process-5 worker ${cd} then commit`, kind: 'shell', agent: true, at: () => wt, cmd: () => `${cd} && git commit -m x`,
      rule: 'A cd to the previous dir, the home dir, or a path that does not resolve asks.',
      claude: 'ask', bob: 'warn', v1: null, v2: null })),
  { id: 'process-5 with consent off', kind: 'shell', cmd: () => 'git commit -m x', extra: ['--no-consent'],
    rule: '--no-consent drops the commit and push ask on the hooks.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  // ---- a rule excluded drops its hook (owner decision, 2026-11-08), each row beside its included
  // twin above. `build` names the install's selection: the hook argv is what `claudeHookGroups` emits
  // for it, and the guard reads the same selection off a carrier's `Active packs:` / `Excluded rules:`
  // lines (`BUILDS`), so removing the derivation, the flag or the guard's reading turns a row red.
  { id: 'process-1 excluded: rule store, by tool', build: 'p1', kind: 'write', path: () => path.join(sb.path, 'user-rules.md'), content: 'a rule',
    rule: 'With process 1 excluded a write to a rule store is ordinary work: every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: rule store, by shell', build: 'p1', kind: 'shell', cmd: () => `echo x > "${path.join(sb.path, 'user-rules.md')}"`,
    rule: 'The shell twin passes too, with no warning on Bob.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: rule draft, by shell', build: 'p1', kind: 'shell', cmd: () => `echo x > "${path.join(sb.path, 'user-rules.draft.md')}"`,
    rule: 'The rule draft follows the rule store: a shell write to it passes on every host.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: a memory file hard-linked to a rule store, by tool', build: 'p1', kind: 'write', path: () => HARD, content: 'a rule',
    rule: 'The hard-link check goes with the rule: every host passes the write.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: a rule store through a non-edit tool', build: 'p1', kind: 'tool', tool: 'mcp_notes_store', args: () => ({ target: path.join(sb.path, 'user-rules.md') }),
    rule: 'A foreign tool naming a rule store is no longer refused. Guard only.',
    claude: null, bob: null, v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: a tool whose arguments nest too deep', build: 'p1', kind: 'tool', tool: 'mcp_notes_store', args: () => (() => { let o = { target: 'x' }; for (let i = 0; i < 40; i += 1) o = { nest: o }; return o; })(),
    rule: 'The depth bound guards only the rule-store search, so it stands down with the rule. Guard only.',
    claude: null, bob: null, v1: 'pass', v2: 'pass' },
  { id: 'process-1 excluded: a root scan still', build: 'p1', kind: 'shell', cmd: () => 'find / -name x',
    rule: 'Excluding process 1 leaves Commands Must Return armed.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'process-1 excluded: a secret still', build: 'p1', kind: 'write', path: () => path.join(proj, 'src', 'a.js'), content: `k = "${SECRET}"`,
    rule: 'Excluding process 1 leaves Sealed Secrets armed.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'process-1 excluded: a protected check still', build: 'p1', kind: 'write', path: () => path.join(proj, 'ci.yml'), content: 'on: push',
    rule: 'Excluding process 1 leaves External Gate armed.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'process-1 pack off: rule store, by tool', build: 'packs', kind: 'write', path: () => path.join(sb.path, 'user-rules.md'), content: 'a rule',
    rule: 'With the whole process pack off, as for process 5, the rule-store check goes too: every host passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'ops-2 excluded: root scan', build: 'o2', kind: 'shell', cmd: () => 'find / -name x',
    rule: 'With ops 2 excluded a recursive scan of a filesystem root is the host\'s business: every host passes it.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'ops-2 excluded: a catastrophic command still', build: 'o2', kind: 'shell', cmd: () => 'rm -rf /',
    rule: 'Excluding ops 2 leaves Law IV armed.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'ops-2 excluded: rule store still', build: 'o2', kind: 'write', path: () => path.join(sb.path, 'user-rules.md'), content: 'a rule',
    rule: 'Excluding ops 2 leaves Persist Insight armed.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'ask' },
  { id: 'ops-2 pack off: root scan', build: 'packs', kind: 'shell', cmd: () => 'find / -name x',
    rule: 'With the whole ops pack off the root-scan check goes too: every host passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  // ---- the ownership first-write gate
  { id: 'ownership first write', kind: 'write', session: true, path: () => path.join(app, 'src', 'x.js'), content: 'x',
    rule: 'The first write of a session into an application repo with no ownership decision is DENIED (an instruction to the agent, not a prompt); Bob blocks (exit 2) and the guard refuses.',
    claude: 'deny', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'ownership first write with the gate off', kind: 'write', session: true, path: () => path.join(app, 'src', 'x.js'), content: 'x',
    extra: ['--no-ownership-gate'], rule: '--no-ownership-gate switches the first-write gate off on the hooks.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  // ---- fail closed
  { id: 'gate error: a payload that is not JSON', kind: 'raw', stdin: 'not json',
    rule: 'A gate that cannot read its input asks on Claude and warns on Bob; it never defers silently. The guard has no stdin.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  // ---- the two switches, each row beside its armed twin. The plugin columns are null: the guard
  // reads its switch from the carrier at load, so tests/unit/gate_switches.test.mjs proves them.
  { id: 'switch: a protected check, armed', kind: 'write', path: () => path.join(proj, 'ci.yml'), content: 'x',
    rule: 'The armed twin: a write to a listed check asks on Claude and blocks on Bob.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: a protected check, gate off', kind: 'write', path: () => path.join(proj, 'ci.yml'), content: 'x',
    extra: ['--no-external-gate'], rule: '--no-external-gate stops the protected-check ask on the write path.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'switch: a shell write to a protected check, armed', kind: 'shell', cmd: () => 'echo x > ci.yml',
    rule: 'The armed twin: a parsed shell write to a listed check asks on Claude and blocks on Bob.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: a shell write to a protected check, gate off', kind: 'shell', cmd: () => 'echo x > ci.yml',
    extra: ['--no-external-gate'], rule: '--no-external-gate stops the same ask on the shell path.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'switch: gate configuration, armed', kind: 'write', path: () => path.join(install, 'AGENT.md'), content: 'x',
    rule: 'The armed twin: a write to the install carrier asks on Claude and blocks on Bob.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: gate configuration, gate off', kind: 'write', path: () => path.join(install, 'AGENT.md'), content: 'x',
    extra: ['--no-external-gate'], rule: '--no-external-gate stops the gate-configuration ask too.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'switch: other gates under --no-external-gate, a secret', kind: 'write', path: () => path.join(proj, 'src', 'a.js'),
    content: `k = "${SECRET}"`, extra: ['--no-external-gate'], rule: 'The switch leaves Sealed Secrets alone.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: other gates under --no-external-gate, a store', kind: 'shell',
    cmd: () => `echo x > "${path.join(install, 'memory', 'a.md')}"`, extra: ['--no-external-gate'],
    rule: 'A shell write to the memory store passes with the switch too: memory is written freely.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'switch: other gates under --no-external-gate, a rule store', kind: 'shell',
    cmd: () => `echo x > "${path.join(sb.path, 'user-rules.md')}"`, extra: ['--no-external-gate'],
    rule: 'The switch leaves the rule check alone: a shell write to user-rules.md still asks, and warns on Bob.',
    claude: 'ask', bob: 'warn', v1: null, v2: null },
  { id: 'switch: other gates under --no-external-gate, a loss', kind: 'shell', ws: true, cmd: () => 'git branch -D main',
    extra: ['--no-external-gate'], rule: 'The switch leaves the real-loss check alone.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: a weakened test, armed', kind: 'write', path: () => path.join(proj, 'src', 'a.test.js'),
    content: 'it.skip("x", () => {})', rule: 'The armed twin: a write adding a skip marker runs, and the agent is told: a note on Claude, a stderr line on Bob.',
    claude: 'note', bob: 'warn', v1: null, v2: null },
  { id: 'switch: a weakened test, note off', kind: 'write', path: () => path.join(proj, 'src', 'a.test.js'),
    content: 'it.skip("x", () => {})', extra: ['--no-test-note'], rule: '--no-test-note silences the edit-time note on every hook host.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'switch: other gates under --no-test-note, a secret', kind: 'write', path: () => path.join(proj, 'src', 'a.test.js'),
    content: `k = "${SECRET}"`, extra: ['--no-test-note'], rule: 'The note switch judges nothing else: a secret in a test file still asks.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  // ---- a write tool aimed at a shared carrier: replayed, and judged by the first block alone.
  ...[
    ['a line added inside the block, the first of two steps', 'Done gate: off', 'Done gate: off\nExternal gate: on'],
    ['on turned to off, the second step', 'External gate: on', 'External gate: off'],
    ['a line behind a lone CR', 'Done gate: off', 'Done gate: off\rExternal gate: off'],
    ['a line behind U+2028', 'Done gate: off', 'Done gate: off\u2028External gate: off'],
    ['a fake block before the real one', '# notes', `${BLOCK_OF('External gate: off')}\n# notes`],
    ['an opening delimiter alone before the block', '# notes', '<!-- BEGIN GENESEED -->\n# notes'],
  ].map(([what, old, now]) => ({ id: `carrier: ${what}`, kind: 'edit', path: () => CARRIER, old, now,
    rule: 'An edit that changes the first block as the reader reads it asks, whatever its text.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' })),
  { id: 'carrier: a stream name', kind: 'write', path: () => `${CARRIER}::$DATA`, content: 'x',
    rule: 'CLAUDE.md::$DATA writes CLAUDE.md, so the name is normalized first.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'carrier: a trailing dot', kind: 'write', path: () => `${CARRIER}.`, content: 'x',
    rule: 'CLAUDE.md. writes CLAUDE.md too.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'carrier: an edit outside the block', kind: 'edit', path: () => CARRIER, old: '# tail', now: '# my tail\nExternal gate: off',
    rule: 'The user\'s own notes are silent, even naming a marker: the reader does not read them.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'carrier: a whole write that keeps the block', kind: 'write', path: () => CARRIER, content: `# other\n${CARRIER_TEXT.slice(8)}`,
    rule: 'A whole write is replayed too: the same block, so it passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'carrier: a new file with no block', kind: 'write', path: () => path.join(proj, 'AGENTS.md'), content: 'External gate: off\n',
    rule: 'No block before or after, so nothing a reader reads has moved.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'carrier: an edit it cannot replay', kind: 'edit', path: () => CARRIER, old: 'no such text', now: 'x',
    rule: 'An edit whose old text is not found once cannot be replayed, so it asks.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'carrier: a tool it cannot replay', kind: 'raw',
    stdin: JSON.stringify({ tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(proj, 'CLAUDE.md'), new_source: 'x' }, cwd: proj }),
    rule: 'A write shape with no replay asks, even with no block in sight.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'carrier: a patch touching a block', kind: 'tool', tool: 'apply_patch', args: () => ({ patchText: `*** Begin Patch\n*** Update File: ${CARRIER}\n@@\n-# tail\n+# my tail\n*** End Patch` }),
    rule: 'The guard does not replay a patch, so one on a file with a block is refused.',
    claude: null, bob: null, v1: 'deny', v2: 'deny' },
  { id: 'carrier: a patch with no delimiter in sight', kind: 'tool', tool: 'apply_patch', args: () => ({ patchText: `*** Begin Patch\n*** Update File: ${path.join(proj, 'AGENTS.md')}\n@@\n+# note\n*** End Patch` }),
    rule: 'A line patch cannot form a block neither side holds the opening of, so it passes.',
    claude: null, bob: null, v1: 'pass', v2: 'pass' },
  { id: 'carrier: over the cap', kind: 'edit', path: () => path.join(proj, 'big', 'CLAUDE.md'), old: '# one', now: '# two',
    rule: 'A carrier over 1 MB is not replayed, so it asks.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'carrier: an unreadable target', kind: 'write', path: () => path.join(proj, 'dir', 'CLAUDE.md'), content: 'x',
    rule: 'A target that cannot be read asks: here a folder named CLAUDE.md.',
    claude: 'ask', bob: 'exit2', v1: 'deny', v2: 'deny' },
  { id: 'carrier: gate off', kind: 'edit', path: () => CARRIER, old: 'External gate: on', now: 'External gate: off', extra: ['--no-external-gate'],
    rule: 'This ask is External Gate\'s, so its switch stops it.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
  { id: 'carrier: another file', kind: 'write', path: () => path.join(proj, 'src', 'notes.md'), content: 'External gate: off\n',
    rule: 'No reader reads a marker there, so it passes.',
    claude: 'pass', bob: 'pass', v1: 'pass', v2: 'pass' },
  { id: 'carrier: Bob global rules file', kind: 'write', path: () => path.join(install, 'rules', 'geneseed.md'), content: 'x',
    rule: 'Bob global\'s whole carrier is gate configuration, as AGENT.md is.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'switch: a valued flag disarms nothing', kind: 'write', path: () => path.join(proj, 'ci.yml'), content: 'x',
    extra: ['--no-external-gate=false'], rule: 'Only the bare flag sets a switch, so this spelling leaves the gate armed.',
    claude: 'ask', bob: 'exit2', v1: null, v2: null },
  { id: 'a well-formed absence', kind: 'raw', stdin: '{}',
    rule: 'An empty object has nothing to judge, so it passes: asking would teach the user to allow-list the gate.',
    claude: 'pass', bob: 'pass', v1: null, v2: null },
];

// ---- driving the hook hosts ----------------------------------------------------------------
const cwdOf = (row) => (row.ws ? ws.repo : row.at ? row.at() : proj);

function payloadFor(row, host) {
  if (row.kind === 'raw') return row.stdin;
  const cwd = cwdOf(row);
  const session = row.session ? { session_id: randomUUID() } : {};
  // Claude Code sets `agent_id`/`agent_type` on tool events inside a subagent; Bob sends none.
  if (row.agent && host !== 'bob') Object.assign(session, { agent_id: 'a1b2c3', agent_type: 'developer' });
  if (row.kind === 'edit') {
    return JSON.stringify(host === 'bob'
      ? { event: 'PreToolUse', tool: 'search_and_replace', input: { path: row.path(), search: row.old, replace: row.now }, cwd, ...session }
      : { tool_name: 'Edit', tool_input: { file_path: row.path(), old_string: row.old, new_string: row.now }, cwd, ...session });
  }
  if (host === 'bob') {
    const input = row.kind === 'shell' ? { command: row.cmd() }
      : row.kind === 'read' ? { path: row.path() } : { path: row.path(), content: row.content };
    const tool = row.kind === 'shell' ? 'execute_command' : row.kind === 'read' ? 'read_file' : 'write_to_file';
    return JSON.stringify({ event: 'PreToolUse', tool, input, cwd, ...session });
  }
  const tool_input = row.kind === 'shell' ? { command: row.cmd() } : { file_path: row.path(), content: row.content };
  return JSON.stringify({ tool_name: row.ps ? 'PowerShell' : row.kind === 'shell' ? 'Bash' : 'Write', tool_input, cwd, ...session });
}

/** The verdict of one hook process, from its exit code and which streams it used. */
function verdictOf(r, what) {
  if (r.status === 2) return 'exit2';
  assert.equal(r.status, 0, `${what}: exit ${r.status}, stderr: ${r.stderr}`);
  if (r.stdout.trim()) {
    const said = JSON.parse(r.stdout).hookSpecificOutput;
    return said.permissionDecision ?? (said.additionalContext ? 'note' : 'pass');
  }
  return r.stderr.includes('[geneseed]') ? 'warn' : 'pass';
}

// The switches the emit gives `verb` on `host` for a row's `build`, read off the real hook command.
function derivedFlags(row, host, verb) {
  if (!row.build) return [];
  const { doctrines = null, excluded = [] } = BUILDS[row.build];
  const cmds = Object.values(claudeHookGroups(install, { runner: 'node', entry: 'x' }, doctrines, excluded, host))
    .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  return cmds.find((c) => c.includes(` ${verb} --root `)).split(/\s+/).filter((t) => /^--no-/.test(t));
}

function runHook(row, host) {
  const verb = host === 'bob' ? 'tool-gate' : row.kind === 'shell' ? 'git-gate' : 'rule-gate';
  const argv = [verb, '--root', install, ...(host === 'bob' ? ['--host', 'bob'] : host === 'openclaude' ? ['--host', 'openclaude'] : []),
    ...(row.extra || []), ...derivedFlags(row, host, verb)];
  const env = row.ws ? { ...base, ...Object.fromEntries(Object.entries(ws.env).filter(([k]) => k.startsWith('GIT_'))) } : base;
  const r = spawnHook(argv, payloadFor(row, host), { cwd: cwdOf(row), env });
  return verdictOf(r, `${row.id} [${host}]`);
}

// ---- driving the OpenCode guard ------------------------------------------------------------
const GIT_KEYS = Object.keys(ws.env).filter((k) => k.startsWith('GIT_'));
async function withGitEnv(row, fn) {
  if (!row.ws) return fn();
  const saved = GIT_KEYS.map((k) => [k, process.env[k]]);
  for (const k of GIT_KEYS) process.env[k] = ws.env[k];
  try { return await fn(); } finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// A row with a `build` runs a guard loaded from that build's carrier. The guard reads it once at
// import, so each carrier is its own module instance (a query string), with $GENESEED_HARNESS set
// only for the import.
const guardUrl = pathToFileURL(path.resolve('adapters/opencode/plugins/geneseed-guard.js')).href;
const guards = new Map();
async function guardOf(build) {
  if (!build) return { GeneseedGuard, default: guardModule };
  if (!guards.has(build)) {
    const saved = process.env.GENESEED_HARNESS;
    process.env.GENESEED_HARNESS = carrierDir(build);
    try { guards.set(build, await import(`${guardUrl}?build=${build}`)); } finally {
      if (saved === undefined) delete process.env.GENESEED_HARNESS; else process.env.GENESEED_HARNESS = saved;
    }
  }
  return guards.get(build);
}

const v1Guards = new Map();
const v2Guards = new Map();
// `variant`: plain (no host prompt known), `always` (the user answered "always" to an edit prompt, so
// the host's ask is gone) or `prompted` (the merged config asks for every edit, so the host will).
async function v1Hook(dir, variant = 'plain', build = '') {
  const key = `${dir}|${variant}|${build}`;
  if (!v1Guards.has(key)) {
    const client = variant === 'plain' ? undefined
      : { config: { get: async () => ({ data: { permission: { edit: { '*': 'ask' } } } }) }, app: { agents: async () => ({ data: [] }) } };
    const g = await (await guardOf(build)).GeneseedGuard({ directory: dir, worktree: dir, client });
    if (variant === 'always') {
      await g.event({ event: { type: 'permission.asked', properties: { id: 'p', permission: 'edit' } } });
      await g.event({ event: { type: 'permission.replied', properties: { requestID: 'p', reply: 'always' } } });
    }
    v1Guards.set(key, g['tool.execute.before']);
  }
  return v1Guards.get(key);
}
async function v2Hooks(dir, build = '') {
  const key = `${dir}|${build}`;
  if (!v2Guards.has(key)) {
    const hooks = { tool: {}, permission: {} };
    const ctx = {
      location: { directory: dir, project: { directory: dir } },
      session: { get: async () => ({}), synthetic: async () => undefined },
      tool: { hook: async (n, cb) => { hooks.tool[n] = cb; return { dispose: async () => {} }; } },
      permission: { hook: async (n, cb) => { hooks.permission[n] = cb; return { dispose: async () => {} }; } },
    };
    await (await guardOf(build)).default.setup(ctx);
    v2Guards.set(key, hooks);
  }
  return v2Guards.get(key);
}

const guardTool = (row) => (row.kind === 'tool' ? row.tool : row.kind === 'edit' ? 'edit' : row.ps ? 'powershell' : row.kind === 'shell' ? 'bash' : row.kind === 'read' ? 'read' : 'write');
const guardArgs = (row) => (row.kind === 'tool' ? row.args() : row.kind === 'edit' ? { filePath: row.path(), oldString: row.old, newString: row.now } : row.kind === 'shell' ? { command: row.cmd() }
  : row.kind === 'read' ? { filePath: row.path() } : { filePath: row.path(), content: row.content });

async function runGuardV1(row) {
  const hook = await v1Hook(cwdOf(row), row.v1as, row.build);
  return withGitEnv(row, async () => {
    try {
      await hook({ tool: guardTool(row), args: guardArgs(row), sessionID: randomUUID() }, {});
      return 'pass';
    } catch (err) {
      if (String(err?.message || '').startsWith('[geneseed-guard]')) return 'deny';
      throw err;
    }
  });
}

async function runGuardV2(row) {
  const hooks = await v2Hooks(cwdOf(row), row.build);
  return withGitEnv(row, async () => {
    const id = randomUUID();
    const event = { tool: guardTool(row), id, sessionID: randomUUID(), input: guardArgs(row) };
    await hooks.tool['execute.before'](event);
    if (event.tool !== guardTool(row)) return 'deny';
    // The call reached the host. Ask the `evaluate` hook what the host's own prompt would do.
    const ask = row.kind === 'shell'
      ? { sessionID: event.sessionID, action: 'shell', resources: ['echo x'], effect: 'allow', source: { type: 'tool', messageID: 'm', id } }
      : { sessionID: event.sessionID, action: row.kind === 'read' || row.kind === 'tool' ? 'read' : 'edit', resources: [row.kind === 'tool' ? 'x' : row.path()], effect: 'allow' };
    await hooks.permission.evaluate(ask);
    return ask.effect === 'ask' ? 'ask' : 'pass';
  });
}

// ---- the tests -----------------------------------------------------------------------------
test('the table covers every verdict and every host column', () => {
  // A table that quietly lost its rows would pass; so the shape it must keep is stated here.
  assert.ok(ROWS.length >= 29, `only ${ROWS.length} rows`);
  const seen = new Set();
  for (const r of ROWS) for (const k of ['claude', 'bob', 'v1', 'v2']) seen.add(`${k}:${r[k]}`);
  for (const want of ['claude:ask', 'claude:deny', 'claude:pass', 'claude:note', 'bob:exit2', 'bob:warn', 'bob:pass',
    'v1:deny', 'v1:pass', 'v2:deny', 'v2:ask', 'v2:pass']) assert.ok(seen.has(want), `no row expects ${want}`);
  assert.equal(new Set(ROWS.map((r) => r.id)).size, ROWS.length, 'row ids are unique');
});

test('each exclusion build\'s carrier reads back as that build', () => {
  // The guard columns read these carriers, so the build's own readers must agree with them.
  for (const [name, { doctrines = PACK_ORDER, excluded = [] }] of Object.entries(BUILDS)) {
    assert.deepEqual(doctrinesOfDir(carrierDir(name)), doctrines, name);
    assert.deepEqual(excludedRulesOfDir(carrierDir(name)), excluded, name);
  }
});

for (const row of ROWS) {
  test(`verdict: ${row.id}`, async () => {
    assert.ok(row.rule && row.rule.endsWith('.'), 'a row states its rule in a sentence');
    if (row.claude !== null) {
      assert.equal(runHook(row, 'claude'), row.claude, `${row.id}: ${row.rule}`);
      assert.equal(runHook(row, 'openclaude'), row.claude, `${row.id} [openclaude]: ${row.rule}`);
    }
    if (row.bob !== null) assert.equal(runHook(row, 'bob'), row.bob, `${row.id} [bob]: ${row.rule}`);
    if (row.v1 !== null) assert.equal(await runGuardV1(row), row.v1, `${row.id} [opencode v1]: ${row.rule}`);
    if (row.v2 !== null) assert.equal(await runGuardV2(row), row.v2, `${row.id} [opencode v2]: ${row.rule}`);
  });
}
