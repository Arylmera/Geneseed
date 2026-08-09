/**
 * `harness uninstall` — the first verb in this port that DELETES.
 *
 * Thirteen subcommands crossed before this one and every one of them either writes or
 * reports. `uninstall` removes a deployed install: the manifest's owned files, the empty
 * directories they leave behind, the settings-file wiring, the managed block in the
 * instruction carrier, the markers, and the registry row that the markers' absence prunes.
 * That changes what the GATE has to prove, in three ways, and all three were settled before
 * a line of this file was written.
 *
 * 1. THE GATE HAS TO PROVE WHAT SURVIVED, not only what went. `golden._snapshot` walks
 *    FILES, so a cell that seeds an install and uninstalls it reports the deletions
 *    perfectly — and says nothing at all about the user's own file in the same directory.
 *    P5c's rule applies directly: an ownership gate needs a positive control beside it. Every
 *    cell here that names a deleted path also seeds an UNOWNED neighbour and names it in
 *    `expect_files`, so a port that deleted by glob instead of by manifest fails.
 * 2. AN EMPTY DIRECTORY WAS INVISIBLE TO EVERY CELL. The ancestor-climb prune is a quarter of
 *    this verb and `_snapshot` could not see it: a port that unlinked the files and left
 *    `skills/<name>/` behind was byte-identical everywhere. Closed by a `<dirs>` column in
 *    `tests/harness_golden.py`'s snapshot rather than a per-cell expectation, because one
 *    entry closes it for all 219 cells written before it existed — `cmdTheme`'s statement
 *    order sat in the same hole. The ABSOLUTE half is a different axis and is the sixth
 *    expectation kind, `expect_absent_files`.
 * 3. `--archive-memory` TOUCHES THE MEMORY STORE, the one thing here a user cannot rebuild.
 *    It is why `_archive_store` MOVES and never deletes, and why the Python's `memory=delete`
 *    disposition has no flag reaching it from the CLI. This port keeps both properties.
 *
 * WHAT IS NOT HERE, AND WHY. `_install_deactivate` / `_install_reactivate` — the reversible
 * siblings that share `_move_tree`, `_prune_empty_ancestors` and the stash — are the WEB and
 * TUI consoles' verbs, not the CLI's. `cmd_uninstall` reaches the stash only to `rmtree` it,
 * which is four lines rather than the ~200 the pair costs, and the port's own criterion for
 * dead code is "part of an asserted partition" — an unported deactivate has no partition to
 * be part of until P6 brings its caller.
 *
 * NO SPAWN. `bin/geneseed-cli.mjs`'s `child_process` allow-list names `js/doctor.mjs` and one
 * argv, and this module does not extend it: every operation here is a filesystem call. That
 * matters more than usual for this verb — `run(['python', 'harness.py', 'uninstall'])` would
 * be byte-identical in every cell of the matrix, and the allow-list plus
 * `test_uninstall_removes_an_install_with_no_python_on_path` are what refute it.
 */
import {
  existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import { confirm } from './setup.mjs';
import {
  claudeReadManifest, emitHostScopeOf, installKind, installState,
  registeredTargets, readMaybe, DISABLED_STASH,
} from './installs.mjs';
import {
  GLOBAL_MANIFEST, HOSTS, VERSION_MARKER, expanduser, opencodeConfigDir, pyResolve,
} from './hosts.mjs';
import {
  managedBlockRemove, opencodeTarget, readJsonc, settingsIntegrityCheck,
  unwireClaudeExcludes, unwireClaudeSettings,
} from './settings.mjs';
import {
  jsonDumps, jsonDumpsIndent, pyIsAbsolute, pyPrint, pyPrintErr, writeText,
} from './lib/pyfs.mjs';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const hostSpec = (host) => HOSTS.find((h) => h.host === host);

/** The Claude-STYLE hosts — one manifest shape, one reversal. Spelled once. */
const CLAUDE_STYLE = ['claude', 'bob', 'copilot'];

/**
 * `shutil.rmtree(p, ignore_errors=True)`.
 *
 * `force: true` already swallows ENOENT; the try/catch is for everything else, which is what
 * `ignore_errors` swallows and `rmSync` throws. The behaviour this preserves is the one
 * `_install_uninstall` step 3 was written around: an ignored error can leave the directory
 * standing while the call reports success, which is why the survivors sweep exists at all.
 */
function rmtreeQuiet(p) {
  try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore_errors=True */ }
}

/** `Path.unlink()` inside a `try: ... except OSError: pass`. */
function unlinkQuiet(p) {
  try { unlinkSync(p); } catch { /* as the Python's bare except OSError */ }
}

/**
 * `Path.rmdir()` — only ever called on a directory this code has just found empty.
 *
 * `rmdirSync`, not `rmSync(p, { recursive: false })`: the latter throws EISDIR on a
 * DIRECTORY, which is the only thing either caller ever hands it. Caught by the first
 * cross-implementation run of the group — every prune reported the directory as an owned
 * file that could not be removed, and the whole matrix came back INCOMPLETE.
 */
function rmdirQuiet(p) {
  try { rmdirSync(p); } catch { /* as the Python's except OSError */ }
}

/** `not any(d.iterdir())` — and False for a path that is not a readable directory. */
function isEmptyDir(p) {
  try { return readdirSync(p).length === 0; } catch { return false; }
}

/**
 * The ancestor climb `_uninstall_global`, `_claude_uninstall` and
 * `_opencode_project_uninstall` each write out inline, in the same four lines.
 *
 * Walking UP rather than clearing the immediate parent is the behaviour: it clears the nested
 * layout of a vendored skill folder (`skills/<name>/references/…`, `…/.claude-plugin/…`) as
 * well as a flat native one. Written once here where the Python has three copies — the three
 * are identical, and this is the half of the verb no cell could see before the `<dirs>`
 * column existed.
 *
 * The Python's loop has NO try/except: an `OSError` from `rmdir` propagates to the caller's
 * per-file handler and lands the file in `failed`. Reproduced exactly, so `rmdirQuiet` is
 * deliberately NOT what this calls.
 */
function pruneAncestors(start, stop) {
  let d = start;
  while (d !== stop && isDir(d) && isEmptyDir(d)) {
    rmdirSync(d);
    d = path.dirname(d);
  }
}

/**
 * The manifest's `owned` list, unlinked one by one with the ancestor prune, returning
 * `[removed, failed]`.
 *
 * The third copy of this loop in `_harness_mcp.py` and the reason it is one function here:
 * `_uninstall_global` (rooted at the target), `_claude_uninstall` (rooted at the cfg dir) and
 * `_opencode_project_uninstall` (rooted at `.opencode/`, and the only one that PREFIXES its
 * failure strings) differ in the root and in the label, which are the two arguments. The
 * `victim.is_file()` guard is load-bearing rather than defensive: a manifest entry naming a
 * directory is SKIPPED, not recursed into, and `removed` counts only what actually went.
 */
function unlinkOwned(base, owned, label = '') {
  let removed = 0;
  const failed = [];
  for (const rel of owned) {
    const victim = path.join(base, rel);
    try {
      if (isFile(victim)) {
        unlinkSync(victim);
        removed += 1;
        pruneAncestors(path.dirname(victim), base);
      }
    } catch (e) {
      // `f"{rel} ({e})"`. `str(OSError)` and an `Error.message` word the same fault
      // differently, and no cell can reach this: it needs a file that exists, is a file, and
      // cannot be unlinked. Recorded rather than papered over — the same standing item
      // `js/excludes.mjs` carries for its `could not remove <stub>` branch.
      failed.push(`${label}${rel} (${e && e.message ? e.message : e})`);
    }
  }
  return [removed, failed];
}

/** The two WARNs every reversal prints when an owned file survives. Identical in all three. */
function warnSurvivors(failed) {
  pyPrintErr('[uninstall] WARN: could not remove '
    + `${failed.length} owned file(s): ${failed.join(', ')}\n`);
}

function warnMarkersKept() {
  pyPrintErr('[uninstall] WARN: the manifest and markers were KEPT so '
    + '`harness uninstall` can be retried once the file(s) are '
    + 'unlocked/removable.\n');
}

/** The markers a completed reversal drops, in the Python's order. */
const REVERSAL_MARKERS = [GLOBAL_MANIFEST, '.geneseed-theme', '.geneseed-emit',
  '.geneseed-footprint', VERSION_MARKER];

/**
 * `_harness_mcp._unmerge_opencode_json` — drop one `instructions` entry, leave every other
 * key intact.
 *
 * A COMMENTED `.jsonc` is not rewritten and the user is told to do it by hand: rewriting it
 * would drop the comments. That branch returns False, so the caller's `unmerged` reports
 * REALITY rather than intent.
 */
export function unmergeOpencodeJson(p, entry) {
  const target = opencodeTarget(p);
  if (!existsSync(target)) return false;
  let cfg;
  let hadComments;
  const text = readMaybe(target);
  if (text === null) return false;             // the Python's `except OSError: return False`
  [cfg, hadComments] = readJsonc(text);
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
  const instr = cfg.instructions;
  if (!Array.isArray(instr) || !instr.includes(entry)) return false;
  if (path.extname(target) === '.jsonc' && hadComments) {
    pyPrint(`[uninstall] ${path.basename(target)} has comments — not rewriting it. Remove `
      + `this from its "instructions" by hand: ${jsonDumps(entry)}\n`);
    return false;
  }
  cfg.instructions = instr.filter((i) => i !== entry);
  writeText(target, `${jsonDumpsIndent(cfg)}\n`);
  return true;
}

/**
 * `_harness_mcp._archive_store` — move a runtime store aside to a sibling
 * `archived-<name>/<timestamp>/`.
 *
 * NEVER a delete. Memory is the one thing in this system a user cannot rebuild, so the
 * destructive verb's most destructive option is still a move; `_archive_memory` is the same
 * function with `memory` hardcoded and is not ported separately because the only caller that
 * reaches it (`_uninstall_global(archive_memory=True)`) is called with `False` by
 * `_install_uninstall`, which is the CLI's only path in.
 *
 * `renameSync` rather than a copy-then-delete: the destination is a SIBLING of the source, so
 * it is the same device by construction and `shutil.move`'s cross-device fallback has nothing
 * to do. ponytail: rename, and the day a store can live on another volume this needs the
 * copy path back.
 */
export function archiveStore(store) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const dest = path.join(path.dirname(store), `archived-${path.basename(store)}`, stamp);
  mkdirSync(path.dirname(dest), { recursive: true });
  renameSync(store, dest);
  return dest;
}

/**
 * `_harness_mcp._settings_file` — the file this install's hooks were actually wired into.
 *
 * `settings.local.json` for a Claude PROJECT install (personal, untracked), `settings.json`
 * everywhere else, and the manifest is the authority. Every lifecycle path must target the
 * file the EMIT wrote, or the hooks linger in one file while the claims chase another.
 */
function settingsFile(cfg, managed) {
  return path.join(cfg, (managed && managed.settings_file) || 'settings.json');
}

/** `_harness_mcp._claude_md_path` — where the manifest says the managed block lives. */
function claudeMdPath(cfg, managed) {
  const rel = ((managed && managed.claude_md) || {}).rel || 'CLAUDE.md';
  return pyResolve(path.join(cfg, rel));
}

/** A manifest's `managed` map, or `{}` — the Python's `isinstance(..., dict)` guard. */
function managedOf(man) {
  const mg = man.managed;
  return typeof mg === 'object' && mg !== null && !Array.isArray(mg) ? mg : {};
}

/** A manifest's `owned` list, or `[]`. */
function ownedOf(man) {
  return Array.isArray(man.owned) ? man.owned : [];
}

/**
 * `_harness_mcp._claude_uninstall` — reverse a Claude-style install at `cfg`.
 *
 * The survivors gate is the part worth reading twice. A locked owned file must NOT take the
 * manifest and markers with it: the manifest is this install's only qualifying signal
 * (`claudeState` keys on it), so deleting it while a file survives would report the install
 * 'absent' and the retry the WARN promises would bounce off `cmdUninstall`'s own gate,
 * stranding the leftovers forever.
 */
export function claudeUninstall(cfg, archiveMemory) {
  const man = claudeReadManifest(cfg);
  const managed = managedOf(man);
  const [removed, failed] = unlinkOwned(cfg, ownedOf(man));
  if (failed.length) warnSurvivors(failed);
  const hooks = managed.settings_hooks || [];
  const unwired = unwireClaudeSettings(settingsFile(cfg, managed), hooks);
  unwireClaudeExcludes(settingsFile(cfg, managed), managed.settings_excludes || []);
  // The unwire is VERIFIED, not assumed: a commented settings file is never rewritten, so a
  // supposedly-uninstalled repo could keep firing Geneseed's hooks. Loud, never fatal.
  settingsIntegrityCheck(settingsFile(cfg, managed), managed, 'absent');
  // Always EXCISE, never whole-file delete: even where Geneseed created CLAUDE.md the user
  // may have added prose since. The file goes only if the excision leaves it empty.
  managedBlockRemove(claudeMdPath(cfg, managed));
  if (failed.length) warnMarkersKept();
  else for (const m of REVERSAL_MARKERS) unlinkQuiet(path.join(cfg, m));
  let archived = null;
  if (archiveMemory && isDir(path.join(cfg, 'memory'))) {
    archived = archiveStore(path.join(cfg, 'memory'));
  }
  // `unmerged` reports REALITY: hooks were recorded AND the unwire actually rewrote the file.
  return { removed, unmerged: Boolean(hooks.length) && unwired, archived, failed };
}

/**
 * `_harness_mcp._uninstall_global` — reverse a global install at `target` via its manifest.
 *
 * Host-aware at the top, and that dispatch is the whole reason a Claude/Bob/Copilot global
 * install and an OpenCode one can share one entry point: the Claude family has no
 * opencode.json to unmerge and a settings.json plus a managed block instead.
 */
export function uninstallGlobal(target, archiveMemory, host = 'opencode') {
  if (CLAUDE_STYLE.includes(host)) return claudeUninstall(target, archiveMemory);
  const man = claudeReadManifest(target);
  const [removed, failed] = unlinkOwned(target, ownedOf(man));
  if (failed.length) warnSurvivors(failed);
  for (const d of ['agents', 'skills', 'plugins']) {
    const p = path.join(target, d);
    if (isDir(p) && isEmptyDir(p)) rmdirQuiet(p);
  }
  const unmerged = unmergeOpencodeJson(path.join(target, 'opencode.json'),
    path.join(target, 'AGENT.md').split(path.sep).join('/'));
  if (failed.length) warnMarkersKept();
  else for (const m of REVERSAL_MARKERS) unlinkQuiet(path.join(target, m));
  let archived = null;
  if (archiveMemory && isDir(path.join(target, 'memory'))) {
    archived = archiveStore(path.join(target, 'memory'));
  }
  return { removed, unmerged, archived, failed };
}

/**
 * `_harness_mcp._mcp_load`, reduced to the OpenCode arm.
 *
 * The Claude arm (`.mcp.json`, `~/.claude.json`, parsed with STRICT `json.loads` because the
 * comment stripper's trailing-comma pass is not string-aware) belongs to the MCP catalog and
 * the TUI, and neither has crossed. `installAgentEntry` is this port's only caller and passes
 * no host, so porting the branch would ship an unreachable arm with no cell and no partition
 * to be part of — the criterion this port decides keep-vs-delete by.
 */
function mcpLoadOpencode(p) {
  if (!existsSync(p)) return {};
  const text = readMaybe(p);
  if (text === null) return {};
  const [data] = readJsonc(text);
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
}

/**
 * `_harness_mcp._install_agent_entry` — the `instructions` entry to drop.
 *
 * A global install wires the ABSOLUTE posix path; a project install wires the relative
 * `…/AGENT.md` the emit recorded, read back off the live config so a bundle sub-dir layout
 * round-trips. `pyIsAbsolute` and not `path.isAbsolute`: they disagree on Windows for a
 * ROOTLESS `/repo/AGENT.md`, which Python keeps and `path.isAbsolute` would have skipped.
 */
export function installAgentEntry(root, kind) {
  if (kind === 'global') {
    return path.join(root, 'AGENT.md').split(path.sep).join('/');
  }
  const cfg = mcpLoadOpencode(opencodeTarget(path.join(root, 'opencode.json')));
  return installAgentEntryOf(cfg.instructions);
}

/**
 * The DECISION half of `installAgentEntry`, split out so the corpus can drive it.
 *
 * A cell can only ever observe the entries a seeded `opencode.json` holds, and the shape
 * that separates the two `is_absolute` rules is a Windows ROOTLESS path — which a cell CAN
 * seed but whose answer then only differs on one platform, in one branch, with no other
 * observable effect. `tests/test_pure_function_parity.py` drives the list directly.
 */
export function installAgentEntryOf(instr) {
  if (Array.isArray(instr)) {
    for (const e of instr) {
      if (typeof e === 'string' && !pyIsAbsolute(e) && path.basename(e) === 'AGENT.md') return e;
    }
  }
  return 'AGENT.md';
}

/**
 * `_harness_mcp._opencode_project_uninstall` — reverse a per-repo OpenCode emit.
 *
 * Two shapes, and which one runs is decided by the manifest's PRESENCE. With one,
 * `.opencode/` is unlinked file by file so a hand-added agent or plugin under it survives;
 * without one — a pre-manifest legacy install — the directory goes whole. The portable bundle
 * dirs beside it (`laws`/`agents`/`skills`) are deleted whole EITHER WAY, because the plain
 * `build()` step wipes and rewrites them every run regardless of what the manifest says.
 *
 * The entry is read BEFORE AGENT.md is deleted. Reading it after would find the wire
 * describing a file that no longer exists, which the fallback would then paper over with the
 * canonical spelling — and a bundle sub-dir layout would be left wired.
 */
export function opencodeProjectUninstall(root) {
  const entry = installAgentEntry(root, 'project');
  let removed = 0;
  let failed = [];
  const oc = path.join(root, '.opencode');
  const manifestPath = path.join(oc, GLOBAL_MANIFEST);
  if (isFile(manifestPath)) {
    const man = claudeReadManifest(oc);
    [removed, failed] = unlinkOwned(oc, ownedOf(man), '.opencode/');
    if (failed.length) warnSurvivors(failed);
    // Survivors gate, mirroring the other two reversals: `_project_qualifies` keys off the
    // manifest, so deleting it while an owned file survives makes the install unfindable.
    if (!failed.length) {
      unlinkQuiet(manifestPath);
      if (isDir(oc) && isEmptyDir(oc)) rmdirQuiet(oc);
    } else {
      warnMarkersKept();
    }
  } else if (isDir(oc)) {
    rmtreeQuiet(oc);
    removed += 1;
  }
  for (const d of ['laws', 'agents', 'skills']) {
    const p = path.join(root, d);
    if (isDir(p)) { rmtreeQuiet(p); removed += 1; }
  }
  const am = path.join(root, 'AGENT.md');
  if (isFile(am)) { unlinkQuiet(am); removed += 1; }
  const unmerged = unmergeOpencodeJson(path.join(root, 'opencode.json'), entry);
  const result = { removed, unmerged, archived: null };
  if (failed.length) result.failed = failed;
  return result;
}

/** `_harness_mcp._install_data_dir` — where the manifest and the runtime stores live. */
export function installDataDir(root, host = 'opencode', scope = 'global') {
  if (scope === 'project' && CLAUDE_STYLE.includes(host)) {
    return path.join(root, hostSpec(host).projectMarker);
  }
  return root;
}

/**
 * `_harness_mcp._owned_dirs_for` — the dirs the reversal was supposed to have emptied.
 *
 * EXISTENCE is the retry signal, not emptiness: the reversals only `rmdir` a directory they
 * found empty, so a survivor here means either a locked file inside it or the `rmdir` itself
 * failing, and both are retry-worthy.
 */
export function ownedDirsFor(root, host, scope, data) {
  const dirs = [path.join(data, 'agents'), path.join(data, 'skills')];
  if (host === 'opencode') {
    if (scope === 'project') {
      dirs.push(path.join(root, '.opencode'), path.join(root, 'laws'));
    } else {
      dirs.push(path.join(data, 'plugins'));
    }
  }
  return dirs;
}

/**
 * `_harness_mcp._install_uninstall` — permanently remove the install at `root`, then de-list
 * it. Every op is best-effort and idempotent, so a partly-removed install can be retried.
 *
 * STEP 3 IS THE ONE WITH THE ARGUMENT IN IT. The ROOT markers are what the registry
 * self-prunes a row by, and dropping them while anything survived would make the install
 * unfindable and therefore unretriable — an OpenCode PROJECT install in particular carries no
 * manifest at the root, so `.geneseed-emit` is its only qualifying signal. The directory
 * sweep alone is not enough either: `ownedDirsFor` watches agents/skills (+ .opencode/laws/
 * plugins), so a locked owned file OUTSIDE those (Bob's `rules/geneseed.md`) would slip the
 * gate while the reversal kept its manifest, and deleting the root markers here would then
 * contradict that "KEPT" promise. The reversal's own `failed` list closes that hole.
 */
export function installUninstall(root, host = 'opencode', scope = 'global', memory = 'keep') {
  if (!['keep', 'archive', 'delete'].includes(memory)) memory = 'keep';
  if (installState(root, host, scope) === 'absent') {
    return { ok: false, error: 'nothing installed here' };
  }
  const data = installDataDir(root, host, scope);
  // 1. The matching per-host reversal, then the disabled-state stash — its bytes are this
  //    install's, and they go with it.
  let summary;
  if (CLAUDE_STYLE.includes(host)) {
    summary = claudeUninstall(data, false);
    rmtreeQuiet(path.join(data, DISABLED_STASH, host));
  } else if (installKind(root) === 'global') {
    summary = uninstallGlobal(root, false, 'opencode');
    rmtreeQuiet(path.join(root, DISABLED_STASH));
  } else {
    summary = opencodeProjectUninstall(root);
    rmtreeQuiet(path.join(root, DISABLED_STASH));
  }
  // 2. Memory + notebook, independent of the owned-file removal above.
  const archived = [];
  for (const name of ['memory', 'notebook']) {
    const store = path.join(data, name);
    if (!isDir(store)) continue;
    if (memory === 'archive') archived.push(archiveStore(store));
    else if (memory === 'delete') rmtreeQuiet(store);
  }
  // 3. The root markers, but only once the reversal's dirs are actually gone.
  const failed = summary.failed || [];
  const survivors = ownedDirsFor(root, host, scope, data).filter((d) => existsSync(d));
  if (survivors.length || failed.length) {
    if (survivors.length && !failed.length) {
      // With `failed` set the reversal already warned twice — no third overlapping WARN.
      pyPrintErr('[uninstall] WARN: could not fully remove the install — still present: '
        + `${survivors.join(', ')}. The install marker was KEPT so you can retry `
        + '`harness uninstall` once the file(s) are unlocked/removable.\n');
    }
    const out = {
      ok: true,
      removed: summary.removed ?? 0,
      memory,
      incomplete: survivors.concat(failed.filter((f) => !survivors.includes(f))),
    };
    if (archived.length) out.archived = archived;
    return out;
  }
  for (const m of ['.geneseed-emit', '.geneseed-theme', VERSION_MARKER]) {
    unlinkQuiet(path.join(root, m));
  }
  // 4. Tidy an emptied marker dir (.claude/.bob) so no husk lingers in the repo.
  if (data !== root && isDir(data) && isEmptyDir(data)) rmdirQuiet(data);
  const out = { ok: true, removed: summary.removed ?? 0, memory };
  if (archived.length) out.archived = archived;
  return out;
}

/**
 * `_harness_mcp._project_qualifies` — does `root` carry a REAL Geneseed project install?
 *
 * The marker dir exists, is not the host's global config dir seen from its parent (the
 * `installTargets` aliasing guard), and shows Geneseed's own tracks: the manifest, or the
 * root `.geneseed-emit` naming this host's project emit for a pre-manifest legacy install.
 * A bare non-Geneseed `.claude/` is very common and must never hijack the resolve.
 */
export function projectQualifies(root, host) {
  const spec = hostSpec(host);
  const cfg = path.join(root, spec.projectMarker);
  if (!isDir(cfg)) return false;
  try {
    if (pyResolve(cfg) === pyResolve(spec.configDir())) return false;
  } catch { /* as the Python's bare `except Exception: pass` */ }
  if (isFile(path.join(cfg, GLOBAL_MANIFEST))) return true;
  const hs = emitHostScopeOf(root);
  return Boolean(hs) && hs[0] === host && hs[1] === 'project';
}

/**
 * `_harness_mcp._uninstall_resolve` — (host, scope, root), or null.
 *
 * Precedence, most-specific first, and the ORDER of the first two is the subtle one: `~/.claude`
 * is NAMED like a project marker and is the global install, never `claude:project` rooted at
 * `$HOME`, so the global-config-dir case is checked before the marker-name case.
 *
 *   1. `--target` IS a host's global config dir.
 *   2. `--target` IS a project marker dir itself (…/.claude) — root is its parent.
 *   3. `--target` (as a root) carries a Geneseed project install.
 *   4. `--target` given and unrecognised — null, and the caller reports it.
 *   5. No `--target`: the cwd, then the OpenCode global config dir.
 */
export function uninstallResolve(targetArg) {
  const globalHit = (p) => {
    for (const spec of HOSTS) {
      try {
        if (p === pyResolve(spec.configDir())) return [spec.host, 'global', p];
      } catch { continue; }
    }
    return null;
  };
  const projectHit = (root) => {
    for (const spec of HOSTS) {
      if (projectQualifies(root, spec.host)) return [spec.host, 'project', root];
    }
    return null;
  };
  if (targetArg) {
    const p = pyResolve(expanduser(targetArg));
    const hit = globalHit(p);
    if (hit) return hit;
    for (const spec of HOSTS) {
      if (path.basename(p) === spec.projectMarker && isDir(p)
          && projectQualifies(path.dirname(p), spec.host)) {
        return [spec.host, 'project', path.dirname(p)];
      }
    }
    return projectHit(p);
  }
  // `.resolve()` so the cwd fallback matches every other branch and the registry, which
  // stores resolved paths — a short-form (8.3) cwd, as Windows CI hands back for %TEMP%,
  // would otherwise return a root that LOOKS different from the identical directory.
  const hit = projectHit(pyResolve(process.cwd()));
  if (hit) return hit;
  return ['opencode', 'global', opencodeConfigDir()];
}

/**
 * `_harness_mcp._surviving_project_installs` — the PROJECT installs still on record.
 *
 * A global uninstall never cascades: each project install is self-contained, its hook
 * commands invoke the shared checkout by absolute path rather than anything under the global
 * config dir. The registry is the only place a project install outside the cwd can be
 * rediscovered from, and the just-removed root is excluded.
 */
export function survivingProjectInstalls(removedRoot) {
  const rroot = pyResolve(removedRoot);
  const out = [];
  for (const [host, scope, root] of registeredTargets()) {
    if (scope !== 'project') continue;
    try { if (pyResolve(root) === rroot) continue; } catch { /* as the Python's except OSError */ }
    out.push([host, scope, root]);
  }
  return out;
}

/** `_harness_mcp._print_surviving_project_inventory` — informational, never a cascade. */
export function printSurvivingProjectInventory(removedRoot) {
  const survivors = survivingProjectInstalls(removedRoot);
  if (!survivors.length) return;
  pyPrint(`[uninstall] ${survivors.length} project install(s) remain — the global removal `
    + 'does not affect them (each is self-contained):\n');
  for (const [host, scope, root] of survivors) {
    pyPrint(`  - ${root} (${host}:${scope}) — remove with: `
      + `harness uninstall --target "${root}" --yes\n`);
  }
}

/**
 * `_harness_mcp._print_other_host_hits` — one message per ADDITIONAL host at the same root.
 *
 * A repo can carry `.opencode/`, `.claude/` and `.bob/` side by side and `uninstall` only ever
 * removes the one it resolved to, so a repeat run needs to know there is more to do.
 */
export function printOtherHostHits(root, removedHost) {
  for (const spec of HOSTS) {
    if (spec.host !== removedHost && projectQualifies(root, spec.host)) {
      pyPrint(`[uninstall] also found ${spec.host}:project here — run \`harness `
        + 'uninstall\` again to remove it.\n');
    }
  }
}

/**
 * `_harness_setup._confirm`, and the only interactive read this verb makes.
 *
 * MOVED TO `js/setup.mjs` IN P5i, where the Python's own owner is: `_confirm` lives in
 * `_harness_setup` beside the `_ask` it is built on, and `setup` is its second caller. The
 * body stayed here for one phase because a helper with one caller is not shared yet; the
 * rule this port uses is that the SECOND owner is what moves it, and a byte gate is what
 * licenses the move.
 *
 * UNREACHABLE FROM EVERY CELL, restated because moving it does not change that: `cmdUninstall`
 * only reaches it when stdin is a TTY, and the harness gives every cell a pipe. What the
 * cells DO gate is the branch beside it — the non-interactive refusal — which is why that one
 * has an `expect` naming its wording. It is now gated positively too, by the stdin-seeded
 * corpus P5i added for the wizard.
 */

/**
 * `_harness_mcp.cmd_uninstall`.
 *
 * The printing is the loud half and the deletions are the quiet one; the cells gate both. The
 * inventory at the end is informational in the strict sense — a global uninstall never
 * touches a project install, and saying so is the only thing those two branches do.
 */
export function cmdUninstall(args) {
  const hit = uninstallResolve(args.target);
  if (hit === null) {
    // `uninstallResolve(null)` never returns null — it falls back to the OpenCode global
    // default — so reaching here means `--target` was given and was not recognised.
    const targetDesc = pyResolve(expanduser(args.target));
    pyPrintErr(`[uninstall] no Geneseed install detected at ${targetDesc}.\n`
      + '[uninstall] pass --target <repo> for a project install (.opencode/.claude/'
      + '.bob/.github) or --target <config dir> for a global one.\n');
    return 1;
  }
  const [host, scope, root] = hit;
  if (installState(root, host, scope) === 'absent') {
    const where = scope === 'project' && host !== 'opencode'
      ? ` under ${hostSpec(host).projectMarker}/` : '';
    pyPrintErr(`[uninstall] no ${host}:${scope} Geneseed install at ${root} `
      + `(no ${GLOBAL_MANIFEST}${where}).\n`);
    return 1;
  }
  const data = installDataDir(root, host, scope);
  const stores = ['memory', 'notebook'].filter((n) => isDir(path.join(data, n)));
  pyPrint(`[uninstall] target: ${root} (${host}:${scope})\n`);
  if (host === 'copilot') {
    pyPrint('[uninstall] removes: agents/, skills/, markers, and the '
      + `${hostSpec(host).agentFile} managed block (Copilot has no `
      + 'settings.json/hooks to unwire; your own .github files are kept).\n');
  } else if (host === 'claude' || host === 'bob') {
    pyPrint('[uninstall] removes: agents/, skills/, markers, the '
      + `${hostSpec(host).agentFile} managed block, and Geneseed's `
      + 'settings.json hooks/excludes (your own keys/hooks are kept).\n');
  } else if (scope === 'global') {
    pyPrint('[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and the '
      + 'opencode.json instructions entry.\n');
  } else {
    pyPrint('[uninstall] removes: AGENT.md, .opencode/, laws/, agents/, skills/, and the '
      + 'opencode.json instructions entry.\n');
  }
  pyPrint('[uninstall] memory/ and notebook/ are kept in place (never deleted here)'
    + (stores.length ? ' — --archive-memory sets both aside.' : '.') + '\n');
  if (stores.length && args.archiveMemory) {
    pyPrint(`[uninstall] ${stores.join(' + ')}: will be ARCHIVED to a sibling `
      + 'archived-<name>/<timestamp>/ (never deleted)\n');
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      pyPrintErr('[uninstall] refusing to proceed without --yes (non-interactive).\n');
      return 1;
    }
    if (!confirm('Proceed with uninstall?', false)) {
      pyPrint('[uninstall] cancelled — nothing removed.\n');
      return 0;
    }
  }
  const memory = args.archiveMemory ? 'archive' : 'keep';
  const s = installUninstall(root, host, scope, memory);
  if (!(s.ok ?? true)) {
    pyPrintErr(`[uninstall] failed: ${s.error || 'unknown error'}\n`);
    return 1;
  }
  const archived = s.archived || [];
  const mem = archived.length ? `archived -> ${archived.join(', ')}` : 'kept in place';
  const cfgfile = host === 'opencode' ? 'opencode.json' : 'settings.json';
  if (s.incomplete && s.incomplete.length) {
    pyPrint(`[uninstall] INCOMPLETE — removed ${s.removed} file(s), but `
      + `${s.incomplete.length} item(s) survived (see the WARN above); `
      + 'the install marker was kept — retry `harness uninstall` once they\'re '
      + `removable. ${cfgfile} updated where needed; memory/notebook ${mem}.\n`);
  } else {
    pyPrint(`[uninstall] done — removed ${s.removed} file(s); ${cfgfile} updated where `
      + `needed; memory/notebook ${mem}. Start a new session to apply.\n`);
  }
  if (scope === 'global') printSurvivingProjectInventory(root);
  else if (scope === 'project') printOtherHostHits(root, host);
  return 0;
}
