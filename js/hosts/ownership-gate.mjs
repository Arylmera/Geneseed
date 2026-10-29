/**
 * The ownership first-write gate — the hook half of the ownership skill (`src/skills/ownership.md`).
 *
 * In an APPLICATION repo (a git root holding a build manifest) whose root `AGENTS.md` has no
 * `## Ownership` section outside Geneseed's managed block, the first write of a session is
 * refused once, with a reason telling the agent to propose the setup to the developer. The hook
 * never sees the developer's answer, so "once" is a marker: the root is recorded per session
 * BEFORE the refusal, and every later write in that (session, repo) passes. The `AGENT.md`
 * pointer line carries the rest, shell writes included (this gate sees Write|Edit|NotebookEdit,
 * and Bob's write tools, only).
 *
 * ON THE HOOK PATH, so builtins plus `gitRootOf` and `normcase` only — both already loaded by
 * `./hooks.mjs`. `managedBlockWrite`'s delimiters are inlined, not imported: `settings.mjs` is a
 * 1 200-line module the gate path must not parse. NEVER THROWS: a throw would reach `guardGate`
 * and become a gate-error ask on every write in every repo; any surprise is a defer.
 *
 * The OpenCode guard (`adapters/opencode/plugins/geneseed-guard.js`, `ownershipBlock`) is this
 * file's twin and cannot import it — keep the two in step.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normcase } from '../lib/paths.mjs';
import { gitRootOf } from './gitref.mjs';

// D5: the build manifests that make a git root an "application". Exact names, plus two families.
const MANIFESTS = new Set(['package.json', 'pom.xml', 'pyproject.toml', 'go.mod', 'Cargo.toml',
  'composer.json', 'Gemfile']);
const isManifest = (n) => MANIFESTS.has(n) || n.startsWith('build.gradle') || n.endsWith('.csproj');

// `managedBlockWrite`'s delimiters (js/hosts/settings.mjs `delimiters('GENESEED')`). On a Bob
// project install the block holds the whole carrier, `#### Ownership` included — hence the strip
// and the exact `##` heading match. `\r?`: a CRLF file's `$` sits after the `\r`.
const MANAGED_BLOCK_RE = /<!-- BEGIN GENESEED -->[\s\S]*?<!-- END GENESEED -->/g;
const SECTION_RE = /^## Ownership[ \t]*\r?$/m;

// Write-shaped tool names (Bob's `tool-gate` also routes reads here: `read_file` carries a path).
export const WRITE_NAME_RE = /write|edit|diff|replace|insert/i;

// js/hosts/activity.mjs `safeStem`, copied (that module is not on the gate path): a hostile
// session id can never steer the marker join out of its directory.
const safeStem = (sid) => String(sid).replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 128);

// The marker folder is PER USER: on a shared POSIX /tmp, one folder for everyone would let a
// second user's marker (or a file planted at the folder's name) silently disarm the gate for
// the first. The uid where there is one; else the user name; Windows' tmpdir is per user anyway.
function userTag() {
  if (typeof process.getuid === 'function') return String(process.getuid());
  try { return safeStem(os.userInfo().username); } catch { return 'user'; }
}

const TAIL = 'Opt out per repo: `## Ownership` with `mode: off` in the root `AGENTS.md`; per '
  + 'install: rebuild with `--no-ownership-gate`. Offer the full documentation '
  + '(`/document-project`) as yes / later. Stop and ask the developer now; re-issue the write only '
  + 'after they answer. This gate fires once per session and repo.';
const REASON_NONE = 'Geneseed (Ownership) — this application has no `AGENTS.md` with '
  + '`## Ownership`. Before writing, propose to the developer: set it up (ownership skill), or '
  + `proceed without for this session. ${TAIL}`;
const REASON_NO_SECTION = 'Geneseed (Ownership) — this application\'s `AGENTS.md` has no '
  + '`## Ownership` section. Before writing, ask the developer: add the Ownership section '
  + `(ownership skill), or proceed without for this session? ${TAIL}`;

/**
 * The refusal reason for this write, or null to defer. `p` is the write target as the payload
 * names it; `body` is the text the write carries (`ruleDecide` already joined it); `installRoot`
 * is the install's own dir (`--root`), whose bookkeeping (memory, notebook) never spends the block.
 */
export function ownershipBlock(p, payload, body, installRoot = null) {
  try {
    const sid = payload && payload.session_id;
    if (typeof sid !== 'string' || !sid) return null;
    // D29: a sub-agent cannot ask the user, and must not spend the session's one block.
    if (payload.agent_id) return null;
    if (!body && !WRITE_NAME_RE.test(String(payload.tool_name || ''))) return null;
    const target = path.resolve(typeof payload.cwd === 'string' ? payload.cwd : '.', p);
    const root = gitRootOf(path.dirname(target));
    if (!root || !readdirSync(root).some(isManifest)) return null;
    // Writing the setup itself is never what the gate stops.
    const rel = normcase(path.relative(root, target));
    if (rel === normcase('AGENTS.md') || rel.startsWith(normcase('.geneseed/'))) return null;
    if (installRoot) {
      const inInstall = path.relative(path.resolve(installRoot), target);
      if (!inInstall.startsWith('..') && !path.isAbsolute(inInstall)) return null;
    }
    let text = null;
    try { text = readFileSync(path.join(root, 'AGENTS.md'), 'utf8'); } catch { /* none: gate */ }
    const own = text === null ? '' : text.replace(MANAGED_BLOCK_RE, '');
    if (SECTION_RE.test(own)) return null;   // on or off, the team has decided
    // shortcut: one small marker file per session, never pruned (the OS temp cleaner owns it);
    // prune here if the folder is ever seen to grow past a few thousand files.
    const dir = path.join(os.tmpdir(), `geneseed-ownership-${userTag()}`);
    const marker = path.join(dir, safeStem(sid));
    const key = normcase(root);
    let seen = '';
    try { seen = readFileSync(marker, 'utf8'); } catch { /* first gated write of the session */ }
    if (seen.split('\n').includes(key)) return null;
    // Recorded BEFORE refusing: a marker that cannot be written must defer, or every write of
    // the session would be refused.
    mkdirSync(dir, { recursive: true });
    appendFileSync(marker, `${key}\n`);
    return own.trim() ? REASON_NO_SECTION : REASON_NONE;
  } catch {
    return null;
  }
}
