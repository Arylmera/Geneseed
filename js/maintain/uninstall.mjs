/**
 * `geneseed uninstall` — the first verb in this port that DELETES.
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
 * AND SINCE P6i, THE REVERSIBLE SIBLINGS ARE HERE TOO. `_install_deactivate` /
 * `_install_reactivate` (and their Claude-style twins) were left out with a due date: "an
 * unported deactivate has no partition to be part of until P6 brings its caller". P6f found
 * the caller — `api_install_toggle` — and P6i ports it, so the pair arrives in the module
 * whose thirteen private helpers it shares (`pruneAncestors`, `settingsFile`, `claudeMdPath`,
 * `managedOf`, `ownedOf`, `installAgentEntry`, `unmergeOpencodeJson`, `rmtreeQuiet`, …),
 * exactly as `_harness_mcp.py` keeps them in one file. Deactivate is `_uninstall_global` with
 * `move` where it has `unlink`, plus an inverse; splitting them would have duplicated the
 * owned-file walk and the ancestor prune a fourth time.
 *
 * NO SPAWN. `ALLOWED_SPAWNS` in `tests/unit/hook_cli.test.mjs` is the table of every module
 * allowed to reach `child_process` and the argv each may use; this module has no row and
 * does not want one, because every operation here is a filesystem call. That matters more
 * than usual for this verb: shelling the uninstall out to an interpreter would have been
 * byte-identical in every cell of the matrix, so only the allow-list refutes it.
 */
import {
  existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import { hookRunnerEntry } from '../../bin/build-driver.mjs';
import { confirm } from './setup.mjs';
import {
  claudeCfg, claudeReadManifest, doctrinesOfDir, emitHostScopeOf, excludedRulesOfDir, installKind,
  installState,
  registeredTargets, readMaybe, DISABLED_STASH,
} from '../hosts/installs.mjs';
import {
  GLOBAL_MANIFEST, HOSTS, VERSION_MARKER, expanduser, opencodeConfigDir, resolvePath,
} from '../hosts/hosts.mjs';
import { mcpCommented } from '../hosts/mcp.mjs';
import {
  copilotIntegrityCheck, managedBlockRead, managedBlockRemove, managedBlockWrite,
  mergeClaudeSettings, mergeCopilotSettings, opencodeTarget, readJsonc,
  settingsIntegrityCheck, wireClaudeExcludes, unwireClaudeExcludes, unwireClaudeSettings,
  unwireCopilotSettings,
} from '../hosts/settings.mjs';
import { printOut, printErr, readText, writeText, isFile, isDir, isOsError } from '../lib/fs.mjs';
import { indexOfDeepEqual, jsonDumps, jsonDumpsIndent, deepEquals } from '../lib/json.mjs';
import { comparePaths, isAbsolutePath, within } from '../lib/paths.mjs';

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
 *
 * THE DIRECTORY TEST IS THE PORT, NOT A PRECAUTION, and it was missing until P3's unit tier
 * asked for it. `shutil.rmtree` REFUSES anything that is not a real directory: handed a file it
 * raises `NotADirectoryError`, handed a symlink it raises outright ("Cannot call rmtree on a
 * symbolic link"), and `ignore_errors=True` turns both into a no-op that leaves the thing on
 * disk. `rmSync(recursive, force)` deletes all three without complaint. The gap is destructive
 * in exactly one direction — the port removes what the reference preserves — and it is
 * REACHABLE: `installDeactivate`'s rollback calls this on `root/.geneseed-disabled`, so a user
 * with a plain FILE of that name at their install root loses it on the port and keeps it on the
 * reference. No cell can see this; nothing plants a file where a stash directory belongs.
 *
 * `lstatSync`, not `statSync`, so a symlink to a directory is refused as the reference refuses
 * it rather than followed.
 */
function rmtreeQuiet(p) {
  try {
    if (!lstatSync(p).isDirectory()) return;
    rmSync(p, { recursive: true, force: true });
  } catch { /* ignore_errors=True, and the missing-path case lands here too */ }
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
      // `js/inspect/excludes.mjs` carries for its `could not remove <stub>` branch.
      failed.push(`${label}${rel} (${e && e.message ? e.message : e})`);
    }
  }
  return [removed, failed];
}

/** The two WARNs every reversal prints when an owned file survives. Identical in all three. */
function warnSurvivors(failed) {
  printErr('[uninstall] WARN: could not remove '
    + `${failed.length} owned file(s): ${failed.join(', ')}\n`);
}

function warnMarkersKept() {
  printErr('[uninstall] WARN: the manifest and markers were KEPT so '
    + '`geneseed uninstall` can be retried once the file(s) are '
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
    printOut(`[uninstall] ${path.basename(target)} has comments — not rewriting it. Remove `
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
  // `toLocaleString('sv-SE')` — LOCAL time, matching the old hand-rolled stamp
  // (`getHours()`/`getMinutes()`/`getSeconds()` are all local-time getters, unlike
  // `toISOString()`'s UTC). sv-SE's default format is already zero-padded
  // "YYYY-MM-DD HH:MM:SS"; stripping the punctuation and reinserting one dash reproduces
  // the exact `YYYYMMDD-HHMMSS` shape the padStart version built by hand.
  const stamp = new Date().toLocaleString('sv-SE').replace(/\D/g, '').replace(/^(\d{8})/, '$1-');
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
  return resolvePath(path.join(cfg, rel));
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
  const sf = settingsFile(cfg, managed);
  // Two shapes, two unwires: a Copilot install records `copilot_hooks` (event → one hook)
  // and never `settings_hooks`, so exactly one of these does anything.
  const unwired = unwireClaudeSettings(sf, hooks)
    | unwireCopilotSettings(sf, managed.copilot_hooks || []);
  unwireClaudeExcludes(sf, managed.settings_excludes || []);
  copilotIntegrityCheck(sf, managed.copilot_hooks || [], 'absent');
  // The unwire is VERIFIED, not assumed: a commented settings file is never rewritten, so a
  // supposedly-uninstalled repo could keep firing Geneseed's hooks. Loud, never fatal.
  settingsIntegrityCheck(sf, managed, 'absent');
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
 * round-trips. `isAbsolutePath` and not `path.isAbsolute`: they disagree on Windows for a
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
      if (typeof e === 'string' && !isAbsolutePath(e) && path.basename(e) === 'AGENT.md') return e;
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
function opencodeProjectUninstall(root) {
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
function installDataDir(root, host = 'opencode', scope = 'global') {
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
      printErr('[uninstall] WARN: could not fully remove the install — still present: '
        + `${survivors.join(', ')}. The install marker was KEPT so you can retry `
        + '`geneseed uninstall` once the file(s) are unlocked/removable.\n');
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
    if (resolvePath(cfg) === resolvePath(spec.configDir())) return false;
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
        if (p === resolvePath(spec.configDir())) return [spec.host, 'global', p];
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
    const p = resolvePath(expanduser(targetArg));
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
  const hit = projectHit(resolvePath(process.cwd()));
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
function survivingProjectInstalls(removedRoot) {
  const rroot = resolvePath(removedRoot);
  const out = [];
  for (const [host, scope, root] of registeredTargets()) {
    if (scope !== 'project') continue;
    try { if (resolvePath(root) === rroot) continue; } catch { /* as the Python's except OSError */ }
    out.push([host, scope, root]);
  }
  return out;
}

/** `_harness_mcp._print_surviving_project_inventory` — informational, never a cascade. */
function printSurvivingProjectInventory(removedRoot) {
  const survivors = survivingProjectInstalls(removedRoot);
  if (!survivors.length) return;
  printOut(`[uninstall] ${survivors.length} project install(s) remain — the global removal `
    + 'does not affect them (each is self-contained):\n');
  for (const [host, scope, root] of survivors) {
    printOut(`  - ${root} (${host}:${scope}) — remove with: `
      + `geneseed uninstall --target "${root}" --yes\n`);
  }
}

/**
 * `_harness_mcp._print_other_host_hits` — one message per ADDITIONAL host at the same root.
 *
 * A repo can carry `.opencode/`, `.claude/` and `.bob/` side by side and `uninstall` only ever
 * removes the one it resolved to, so a repeat run needs to know there is more to do.
 */
function printOtherHostHits(root, removedHost) {
  for (const spec of HOSTS) {
    if (spec.host !== removedHost && projectQualifies(root, spec.host)) {
      printOut(`[uninstall] also found ${spec.host}:project here — run \`harness `
        + 'uninstall` again to remove it.\n');
    }
  }
}

/**
 * `_harness_setup._confirm`, and the only interactive read this verb makes.
 *
 * MOVED TO `js/maintain/setup.mjs` IN P5i, where the Python's own owner is: `_confirm` lives in
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
    const targetDesc = resolvePath(expanduser(args.target));
    printErr(`[uninstall] no Geneseed install detected at ${targetDesc}.\n`
      + '[uninstall] pass --target <repo> for a project install (.opencode/.claude/'
      + '.bob/.github) or --target <config dir> for a global one.\n');
    return 1;
  }
  const [host, scope, root] = hit;
  if (installState(root, host, scope) === 'absent') {
    const where = scope === 'project' && host !== 'opencode'
      ? ` under ${hostSpec(host).projectMarker}/` : '';
    printErr(`[uninstall] no ${host}:${scope} Geneseed install at ${root} `
      + `(no ${GLOBAL_MANIFEST}${where}).\n`);
    return 1;
  }
  const data = installDataDir(root, host, scope);
  const stores = ['memory', 'notebook'].filter((n) => isDir(path.join(data, n)));
  printOut(`[uninstall] target: ${root} (${host}:${scope})\n`);
  if (host === 'copilot') {
    printOut('[uninstall] removes: agents/, skills/, markers, the '
      + `${hostSpec(host).agentFile} managed block, and Geneseed's `
      + '~/.copilot/settings.json hooks on a global install (your own keys/hooks and '
      + '.github files are kept).\n');
  } else if (host === 'claude' || host === 'bob') {
    printOut('[uninstall] removes: agents/, skills/, markers, the '
      + `${hostSpec(host).agentFile} managed block, and Geneseed's `
      + 'settings.json hooks/excludes (your own keys/hooks are kept).\n');
  } else if (scope === 'global') {
    printOut('[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and the '
      + 'opencode.json instructions entry.\n');
  } else {
    printOut('[uninstall] removes: AGENT.md, .opencode/, laws/, agents/, skills/, and the '
      + 'opencode.json instructions entry.\n');
  }
  printOut('[uninstall] memory/ and notebook/ are kept in place (never deleted here)'
    + (stores.length ? ' — --archive-memory sets both aside.' : '.') + '\n');
  if (stores.length && args.archiveMemory) {
    printOut(`[uninstall] ${stores.join(' + ')}: will be ARCHIVED to a sibling `
      + 'archived-<name>/<timestamp>/ (never deleted)\n');
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      printErr('[uninstall] refusing to proceed without --yes (non-interactive).\n');
      return 1;
    }
    if (!confirm('Proceed with uninstall?', false)) {
      printOut('[uninstall] cancelled — nothing removed.\n');
      return 0;
    }
  }
  const memory = args.archiveMemory ? 'archive' : 'keep';
  const s = installUninstall(root, host, scope, memory);
  if (!(s.ok ?? true)) {
    printErr(`[uninstall] failed: ${s.error || 'unknown error'}\n`);
    return 1;
  }
  const archived = s.archived || [];
  const mem = archived.length ? `archived -> ${archived.join(', ')}` : 'kept in place';
  const cfgfile = host === 'opencode' ? 'opencode.json' : 'settings.json';
  if (s.incomplete && s.incomplete.length) {
    printOut(`[uninstall] INCOMPLETE — removed ${s.removed} file(s), but `
      + `${s.incomplete.length} item(s) survived (see the WARN above); `
      + 'the install marker was kept — retry `geneseed uninstall` once they\'re '
      + `removable. ${cfgfile} updated where needed; memory/notebook ${mem}.\n`);
  } else {
    printOut(`[uninstall] done — removed ${s.removed} file(s); ${cfgfile} updated where `
      + `needed; memory/notebook ${mem}. Start a new session to apply.\n`);
  }
  if (scope === 'global') printSurvivingProjectInventory(root);
  else if (scope === 'project') printOtherHostHits(root, host);
  return 0;
}

// ---- P6i: ACTIVATION — the reversible half ---------------------------------------------
//
// Deactivate turns an install OFF without deleting a byte: every owned artifact MOVES into a
// sibling stash and the wiring is dropped. Reactivate moves the same bytes back. The stash
// dir's PRESENCE is the disabled flag and its CONTENTS are the restore source — there is no
// recorded JSON state that could drift from the filesystem, which is the design decision the
// whole port has to preserve rather than improve on.
//
// ALL-OR-NOTHING IS THE PROPERTY, and it is the one a port breaks silently. A move that fails
// puts every earlier move back and reports, leaving the install fully `active`; a port that
// merely stopped on the failure would leave a half-gutted config dir that neither state
// answers for. `tests/web_golden.py`'s `install/a-deactivate-whose-second-move-collides…`
// drives it: a manifest naming a file AND its parent directory is the only shape a seeded
// world can use to make the SECOND move collide.

/**
 * `_harness_mcp._move_tree` — move a file or dir, refusing an existing destination.
 *
 * THE REFUSAL IS THE CONTRACT, not a safety net: the stash is what a reactivate restores
 * FROM, so silently overwriting a destination would destroy the only copy of whatever was
 * already there. The caller catches and rolls back.
 *
 * `raise FileExistsError(dst)` is a SINGLE-ARGUMENT OSError, whose `str()` is just the path,
 * and the caller interpolates it into the `failed` list a cell compares byte for byte — so
 * the message is reproduced exactly here. Node's own fs errors word themselves completely
 * differently (`EEXIST: file already exists, rename 'a' -> 'b'` against Python's
 * `[Errno 17] File exists: 'b'`); that divergence is real, declared, and unreachable from
 * any cell, exactly as `unlinkOwned`'s is — the only arm a seeded world can reach is this
 * one, which is why this one is exact.
 *
 * `renameSync`, not a copy-then-delete: `shutil.move` falls back to a copy across
 * filesystems, and the stash is a SIBLING inside the same root, so there is no device to
 * cross by construction.
 */
function moveTree(src, dst) {
  if (existsSync(dst)) {
    const e = new Error(String(dst));
    e.code = 'EEXIST';
    throw e;
  }
  mkdirSync(path.dirname(dst), { recursive: true });
  renameSync(src, dst);
}

/**
 * `_harness_mcp._stashed_kind` — which kind of install a stash holds, from its CONTENTS.
 *
 * There is no recorded tag, on purpose. A project stash carries `.opencode/`; a global one
 * carries the moved owned files. `null` for an empty or missing stash.
 */
function stashedKind(root) {
  const stash = path.join(root, DISABLED_STASH);
  if (isDir(path.join(stash, '.opencode'))) return 'project';
  if (isDir(stash) && !isEmptyDir(stash)) return 'global';
  return null;
}

/**
 * `_harness_mcp._install_relive` — the disabled install's CONTENT was re-created live.
 *
 * The user ran `build`/`upgrade` while disabled. The live signal is KIND-SPECIFIC and the
 * stashed kind is what picks it: a global deactivate moves AGENT.md aside (leaving the
 * manifest marker, so `installKind` still answers 'global' and would false-positive on its
 * own), a project deactivate leaves AGENT.md alone and moves `.opencode/`.
 */
function installRelive(root) {
  if (stashedKind(root) === 'project') return isDir(path.join(root, '.opencode'));
  return isFile(path.join(root, 'AGENT.md'));
}

/**
 * `_harness_mcp._install_move_list` — the rels to move aside, `_within`-guarded.
 *
 * `path.resolve(rroot, r)` and NOT `path.join`, which is the one line here that is a security
 * boundary rather than a translation. The Python is `(rroot / r).resolve()`, and pathlib's
 * `/` REPLACES the base when the right operand is absolute — so a manifest entry naming
 * `C:/evil.md` resolves outside the root and `_within` rejects it. `path.join` would have
 * concatenated it into `<root>/C:/evil.md`, which passes containment and would then be MOVED.
 * `path.resolve` has pathlib's semantics for exactly this case, and collapses `..` besides,
 * which is why the guard runs on the resolved path rather than the lexical one.
 */
function installMoveList(root, kind) {
  let rels;
  if (kind === 'project') {
    rels = ['.opencode'];
  } else {
    rels = ownedOf(claudeReadManifest(root)).filter((r) => r !== VERSION_MARKER);
  }
  const rroot = resolvePath(root);
  return rels.filter((r) => r && within(resolvePath(path.resolve(rroot, r)), rroot));
}

/**
 * `_harness_mcp._install_readd_entry` — put back JUST the AGENT.md `instructions` entry.
 *
 * Deliberately a minimal inline re-add rather than the emit's own merge, whose side effects
 * (adding `permission` and `lsp: true` when absent) would clobber values the user may have
 * set since the install was disabled. A commented `.jsonc` is not rewritten — the same
 * refusal `unmergeOpencodeJson` makes — but here the files have ALREADY been restored, so it
 * tells the operator what to add rather than failing the whole reactivate. That asymmetry is
 * the reference's and is gated per side.
 */
function installReaddEntry(target, entry) {
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeText(target, `${jsonDumpsIndent({
      $schema: 'https://opencode.ai/config.json', instructions: [entry],
    })}\n`);
    return true;
  }
  let raw;
  try { raw = readText(target); } catch { return false; }   // except OSError
  const [cfg, hadComments] = readJsonc(raw);
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return false;
  const instr = Array.isArray(cfg.instructions) ? cfg.instructions : [];
  if (indexOfDeepEqual(instr, entry) >= 0) return false;
  if (path.extname(target) === '.jsonc' && hadComments) {
    printOut(`[activate] ${path.basename(target)} has comments — not rewriting it. Add this `
      + `to its "instructions" by hand: ${jsonDumps(entry)}\n`);
    return false;
  }
  cfg.instructions = [...instr, entry];
  writeText(target, `${jsonDumpsIndent(cfg)}\n`);
  return true;
}

/**
 * `sorted(stash.rglob('*'))` with the directories dropped.
 *
 * `comparePaths`, not a bare sort: Windows compares paths case-folded and POSIX does not, and
 * the order here decides which collision is reported first in `failed`. Sorting the files
 * alone is the same order as sorting everything and skipping dirs afterwards, which is what
 * the Python does. `isDir` rather than the dirent flag, so a symlinked directory is recursed
 * into exactly as `is_dir()` follows it.
 */
function stashFiles(stash) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = readdirSync(d); } catch { return; }
    for (const name of ents) {
      const full = path.join(d, name);
      if (isDir(full)) walk(full);
      else out.push(full);
    }
  };
  walk(stash);
  return out.sort(comparePaths);
}

/** `rel.as_posix()` for a path already known to be relative. */
const asPosix = (rel) => rel.split(path.sep).join('/');

/**
 * The move-with-rollback loop `installDeactivate` and `claudeDeactivate` each wrote out
 * inline: move every `rel` from `srcBase` to `dstBase`, and on the first failure put every
 * earlier move back onto `srcBase` before reporting it. All-or-nothing is the property
 * (see the P6i note above `moveTree`), so a caught failure never leaves a partial move
 * standing even though this function itself takes no side action on failure beyond the
 * rollback — cleaning up the now-empty stash is the caller's, because the two hosts name
 * their stash differently (`rmtreeQuiet(stash)` plain, `cleanHostStash(cfg, host)` tagged).
 *
 * Returns `{ done }` on a clean run, or `{ done, failed }` once a move has failed and been
 * rolled back — `done` stays the moved-so-far list either way, which is what `rolled_back:
 * done.length` in both callers reports.
 */
function moveAll(srcBase, dstBase, rels) {
  const done = [];
  for (const rel of rels) {
    const src = path.join(srcBase, rel);
    if (!existsSync(src)) continue;   // a manifest entry already gone — nothing to move
    try {
      moveTree(src, path.join(dstBase, rel));
      done.push(rel);
    } catch (e) {
      if (!isOsError(e)) throw e;
      for (const r of [...done].reverse()) {
        try { renameSync(path.join(dstBase, r), path.join(srcBase, r)); } catch { /* OSError */ }
      }
      return { done, failed: [`${rel} (${e.message})`] };
    }
  }
  return { done };
}

/**
 * The stash-restore loop `installReactivate` and `claudeReactivate` each wrote out inline:
 * move every file under `stash` back onto `base`, by its relative path. `skip`, when given,
 * is one relative-posix path to leave untouched — `claudeReactivate`'s
 * `_claude_md_block.txt`, which holds the managed block's TEXT and is restored separately by
 * `managedBlockWrite` rather than a raw file move, because it is not a file that belongs
 * verbatim at that relative path.
 *
 * NEVER deletes the stash while anything is unrestored: a destination collision is a
 * leftover, reported rather than clobbered, so a retry has something left to restore from.
 */
function restoreAll(stash, base, skip = null) {
  const leftovers = [];
  let moved = 0;
  for (const src of stashFiles(stash)) {
    const rel = path.relative(stash, src);
    if (skip && asPosix(rel) === skip) continue;
    const dst = path.join(base, rel);
    if (existsSync(dst)) {
      // NEVER delete the stash while anything is unrestored — skip, keep, report.
      leftovers.push(asPosix(rel));
      continue;
    }
    mkdirSync(path.dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved += 1;
  }
  return { leftovers, moved };
}

/**
 * `_harness_mcp._install_deactivate` — turn an OpenCode install off without deleting a byte.
 *
 * The config edit is the LAST step and the only non-move mutation, so a move failure rolls
 * back cleanly with the `instructions` entry still intact. The prune climbs from each moved
 * file's PARENT so a `skills/<name>/` husk goes too — the half of this function no file
 * snapshot can see, and the reason `tests/web_golden.py` grew a `<dirs>` column in P6i.
 */
export function installDeactivate(root, host = 'opencode', scope = 'global') {
  if (CLAUDE_STYLE.includes(host)) return claudeDeactivate(root, scope, host);
  if (installState(root) !== 'active') {
    return { ok: false, error: `install is not active (${installState(root)})` };
  }
  const kind = installKind(root);
  const target = opencodeTarget(path.join(root, 'opencode.json'));
  // Caught UP FRONT, before any file moves: a commented `.jsonc` cannot be rewritten without
  // dropping the user's comments, so refuse and move NOTHING.
  if (mcpCommented(target)) {
    return { ok: false,
      error: `${path.basename(target)} has comments — refusing to rewrite it. `
        + 'Disable by hand or convert it to plain .json first.' };
  }
  const stash = path.join(root, DISABLED_STASH);
  const { done, failed } = moveAll(root, stash, installMoveList(root, kind));
  if (failed) {
    rmtreeQuiet(stash);
    return { ok: false, failed, rolled_back: done.length };
  }
  unmergeOpencodeJson(path.join(root, 'opencode.json'), installAgentEntry(root, kind));
  for (const rel of done) pruneAncestors(path.dirname(path.join(root, rel)), root);
  return { ok: true, kind, moved: done.length };
}

/** `_harness_mcp._install_reactivate` — the inverse. */
export function installReactivate(root, host = 'opencode', scope = 'global') {
  if (CLAUDE_STYLE.includes(host)) return claudeReactivate(root, scope, host);
  if (installState(root) !== 'disabled') {
    return { ok: false, error: `install is not disabled (${installState(root)})` };
  }
  const stash = path.join(root, DISABLED_STASH);
  const target = opencodeTarget(path.join(root, 'opencode.json'));
  // The re-emit-while-disabled guard: discard the now-stale snapshot rather than clobber the
  // fresh files, ensure the entry is present, and SAY SO. `installRelive`, not `installKind`
  // — a global deactivate leaves the manifest marker behind, so the kind test would lie here.
  if (installRelive(root)) {
    const kind = installKind(root) || 'global';
    rmtreeQuiet(stash);
    installReaddEntry(target, installAgentEntry(root, kind));
    return { ok: true,
      note: 'install was re-created while disabled; discarded the stashed snapshot' };
  }
  const { leftovers, moved } = restoreAll(stash, root);
  if (leftovers.length) return { ok: false, failed: leftovers, moved };
  const kind = installKind(root) || 'global';
  installReaddEntry(target, installAgentEntry(root, kind));
  rmtreeQuiet(stash);
  return { ok: true, kind, moved };
}

// ---- the Claude-style fork (Claude · IBM Bob · GitHub Copilot) ---------------------------
//
// A Claude-style install has NO `instructions` array — the harness reaches the host through
// the CLAUDE.md managed block and the settings.json hooks. So the reversal is three moving
// parts instead of one: stash the owned agents/skills, EXCISE the managed block (stashing its
// content for an exact restore), and unwire the recorded hook groups. The stash lives under a
// host-TAGGED subdir so one root carrying both an OpenCode and a Claude install can disable
// each independently.

/**
 * `_harness_mcp._clean_host_stash` — drop this host's stash and the parent if it empties.
 *
 * So 'disabled' never lingers as an empty marker, and a same-root other-host stash is left
 * standing.
 */
function cleanHostStash(cfg, host = 'claude') {
  rmtreeQuiet(path.join(cfg, DISABLED_STASH, host));
  const parent = path.join(cfg, DISABLED_STASH);
  if (isDir(parent) && isEmptyDir(parent)) rmdirQuiet(parent);
}

/**
 * `_harness_mcp._remerge_claude_hooks` — re-merge the canonical hooks and RECORD the claims.
 *
 * Threading the manifest's recorded claims through is what prunes stale groups; writing the
 * resulting set back is what keeps a group re-added after an interpreter or checkout move
 * from being orphaned at uninstall. The manifest rewrite is atomic through a sibling temp
 * file and swallows its own OSError, exactly as the reference does — a failed bookkeeping
 * write must not fail the reactivate that has already moved every file back.
 */
function remergeClaudeHooks(cfg, root = cfg) {
  const data = claudeReadManifest(cfg);
  const managed = managedOf(data);
  // A Copilot install: its own merge, its own claim key, and none of the pack/exclude axes
  // below — the Copilot gate is not pack-conditional (see `copilotHooks`). Without this
  // branch a Copilot reactivate would write CLAUDE-shaped hook groups into
  // ~/.copilot/settings.json, which Copilot cannot read.
  if (Array.isArray(managed.copilot_hooks)) {
    const [, claims] = mergeCopilotSettings(settingsFile(cfg, managed), managed.copilot_hooks,
      hookRunnerEntry());
    if (!deepEquals(claims, managed.copilot_hooks) && Object.keys(data).length > 0) {
      managed.copilot_hooks = claims;
      data.managed = managed;
      const tmp = path.join(cfg, `${GLOBAL_MANIFEST}.tmp`);
      try {
        writeText(tmp, `${jsonDumpsIndent(data)}\n`);
        renameSync(tmp, path.join(cfg, GLOBAL_MANIFEST));
      } catch { /* except OSError: pass */ }
    }
    return;
  }
  // `hookOpts` is the one argument `mergeClaudeSettings` will not default, and it is right
  // not to: there is no computable fallback for the runner/entry the shim bakes. The
  // emitter's own originator is imported rather than restated — a reactivate that wired a
  // different shim path would point every re-added hook at a file the emitter never writes.
  // The pack selection is read back off the reactivated carrier, not defaulted: a reactivate
  // that re-wired the git-gate into an install whose owner had turned the process pack off
  // would put the boundary back at odds with the prompt. `null` (no marker) keeps the gate.
  //
  // ⚠ THE CARRIER IS NOT ALWAYS UNDER `cfg`, WHICH IS WHY `root` IS A SECOND PARAMETER. On a
  // PROJECT install `cfg` is `<repo>/.claude` and the carrier is `<repo>/CLAUDE.md`, so
  // reading `cfg` alone answered `null` for every project reactivate and re-wired the gate
  // unconditionally (fail-closed, so not a hole — but wrong, and it made the toggle one-way
  // for project installs). `root` first, `cfg` second: copilot keeps its carrier INSIDE the
  // config dir (`.github/copilot-instructions.md`), and on a global install the two are the
  // same directory anyway. Both silent ⇒ `null` ⇒ the gate stays.
  const doctrines = doctrinesOfDir(root) ?? doctrinesOfDir(cfg);
  // Same two-carrier read for the second axis, and its own default: an absent line means
  // NOTHING excluded, so a reactivate can only ever restore a gate, never remove one.
  const excluded = excludedRulesOfDir(root).length ? excludedRulesOfDir(root)
    : excludedRulesOfDir(cfg);
  const [, claims] = mergeClaudeSettings(settingsFile(cfg, managed), 'global',
    managed.settings_hooks ?? null, hookRunnerEntry(), doctrines, excluded);
  // `and data` — a manifest that did not parse is not one to write back.
  if (!deepEquals(claims, managed.settings_hooks ?? null) && Object.keys(data).length > 0) {
    managed.settings_hooks = claims;
    data.managed = managed;
    const tmp = path.join(cfg, `${GLOBAL_MANIFEST}.tmp`);
    try {
      writeText(tmp, `${jsonDumpsIndent(data)}\n`);
      renameSync(tmp, path.join(cfg, GLOBAL_MANIFEST));
    } catch { /* except OSError: pass */ }
  }
}

/** `_harness_mcp._claude_deactivate`. */
function claudeDeactivate(root, scope = 'global', host = 'claude') {
  const cfg = claudeCfg(root, scope, host);
  // `installState` dispatches Claude-style hosts to `claudeState(root, scope, host)`, which
  // is the call the Python makes directly. Same answer, one exported name.
  if (installState(root, host, scope) !== 'active') {
    return { ok: false,
      error: `install is not active (${installState(root, host, scope)})` };
  }
  const man = claudeReadManifest(cfg);
  const managed = managedOf(man);
  const stash = path.join(cfg, DISABLED_STASH, host);
  const rroot = resolvePath(cfg);
  const rels = ownedOf(man).filter((r) => r && r !== VERSION_MARKER
    && within(resolvePath(path.resolve(rroot, r)), rroot));
  const { done, failed } = moveAll(cfg, stash, rels);
  if (failed) {
    cleanHostStash(cfg, host);
    return { ok: false, failed, rolled_back: done.length };
  }
  unwireClaudeSettings(settingsFile(cfg, managed), managed.settings_hooks || []);
  unwireCopilotSettings(settingsFile(cfg, managed), managed.copilot_hooks || []);
  unwireClaudeExcludes(settingsFile(cfg, managed), managed.settings_excludes || []);
  // The same integrity check the uninstall path runs: a deactivate that silently failed to
  // unwire would leave hooks firing in a repo the user believes is off.
  settingsIntegrityCheck(settingsFile(cfg, managed), managed, 'absent');
  copilotIntegrityCheck(settingsFile(cfg, managed), managed.copilot_hooks || [], 'absent');
  const cm = claudeMdPath(cfg, managed);
  const block = managedBlockRead(cm);
  mkdirSync(stash, { recursive: true });   // presence == disabled, even if nothing moved
  if (block !== null) {
    writeText(path.join(stash, '_claude_md_block.txt'), block);
    // ALWAYS EXCISE, never whole-file delete: prose the user added around the block must
    // survive a disable. The file goes only if nothing else remains.
    managedBlockRemove(cm);
  }
  for (const rel of done) pruneAncestors(path.dirname(path.join(cfg, rel)), cfg);
  return { ok: true, kind: host, moved: done.length };
}

/** `_harness_mcp._claude_reactivate`. */
function claudeReactivate(root, scope = 'global', host = 'claude') {
  const cfg = claudeCfg(root, scope, host);
  if (installState(root, host, scope) !== 'disabled') {
    return { ok: false,
      error: `install is not disabled (${installState(root, host, scope)})` };
  }
  const stash = path.join(cfg, DISABLED_STASH, host);
  const blockFile = path.join(stash, '_claude_md_block.txt');
  const reliveManifest = claudeReadManifest(cfg);
  // `.get("managed") or {}` — an `or`, not an isinstance guard, and the difference is
  // observable on a manifest whose `managed` is `null`.
  const reliveManaged = reliveManifest.managed || {};
  let relive = managedBlockRead(claudeMdPath(cfg, reliveManaged)) !== null;
  // Bob GLOBAL writes no managed AGENTS.md block — its preamble carrier is the owned
  // `rules/geneseed.md`, so a live copy of THAT is the relive signal there. Without this arm
  // the guard never fires for bob-global and every stashed file collides with the fresh emit,
  // stranding the install 'disabled' until the stash is deleted by hand.
  if (!relive && !reliveManaged.claude_md) {
    relive = Object.keys(reliveManifest).length > 0
      && isFile(path.join(cfg, 'rules', 'geneseed.md'));
  }
  if (relive) {
    remergeClaudeHooks(cfg, root);   // ensure the hooks are present (and the claims exact)
    cleanHostStash(cfg, host);
    return { ok: true,
      note: 'install was re-created while disabled; discarded the stashed snapshot' };
  }
  const { leftovers, moved } = restoreAll(stash, cfg, '_claude_md_block.txt');
  if (leftovers.length) return { ok: false, failed: leftovers, moved };
  const managed = claudeReadManifest(cfg).managed || {};
  // ⚠ THE CARRIER IS RESTORED BEFORE THE HOOKS ARE RE-MERGED, AND THE ORDER IS LOAD-BEARING.
  // `remergeClaudeHooks` reads the install's pack selection back off the carrier, and on a
  // Claude-style host that selection lives inside the MANAGED BLOCK — which the deactivate
  // stashed. Re-merging first therefore asked a CLAUDE.md with its block cut out, got `null`
  // ("unknown"), and fail-closed straight back to the consent gate: every reactivate re-wired a
  // git-gate the owner had turned off, in both scopes. The two writes touch different files
  // (`CLAUDE.md` vs `settings*.json`), so nothing else depends on which goes first.
  if (existsSync(blockFile)) {
    managedBlockWrite(claudeMdPath(cfg, managed), readText(blockFile));
  }
  remergeClaudeHooks(cfg, root);
  wireClaudeExcludes(settingsFile(cfg, managed), managed.settings_excludes || []);
  cleanHostStash(cfg, host);
  return { ok: true, kind: host, moved };
}
